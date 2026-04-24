import { useEffect, useRef, useState } from "react";
import {
  BadgeCheckIcon,
  CircleDotIcon,
  MicIcon,
  MicOffIcon,
  PhoneCallIcon,
  PhoneOffIcon,
  SendIcon,
  Volume2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type DecisionMode = "answer" | "clarify" | "escalate";

type Decision = {
  mode: DecisionMode;
  approved_text_fi: string;
  case_id: string;
  confidence: number;
  step_id?: string;
  awaits_confirmation?: boolean;
  allowed_followup_types?: string[];
  session_id?: string;
};

type Turn = {
  id: string;
  speaker: "user" | "assistant";
  text: string;
  mode?: DecisionMode;
};

type ConnectionState = "idle" | "connecting" | "connected" | "error";
type SpeechState = "idle" | "listening" | "resolving" | "speaking";

type RealtimeEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  error?: {
    message?: string;
  };
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8787";
const USER_TURN_GRACE_MS = 900;

const statusCopy: Record<ConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  connected: "Connected",
  error: "Needs attention",
};

const speechCopy: Record<SpeechState, string> = {
  idle: "Idle",
  listening: "Listening",
  resolving: "Resolving",
  speaking: "Speaking",
};

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [draft, setDraft] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const speechRecoveryTimeoutRef = useRef<number | null>(null);
  const turnResolutionTimeoutRef = useRef<number | null>(null);
  const pendingTranscriptRef = useRef("");
  const sessionIdRef = useRef(crypto.randomUUID());

  const isConnected = connectionState === "connected";

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  async function connect() {
    setErrorMessage("");
    setConnectionState("connecting");

    try {
      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;
      setMicEnabled(false);

      const audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      audioRef.current = audioElement;

      for (const track of micStream.getAudioTracks()) {
        peerConnection.addTrack(track, micStream);
      }

      peerConnection.ontrack = (event) => {
        audioElement.srcObject = event.streams[0];
      };

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;

      dataChannel.addEventListener("message", (event) => {
        void handleRealtimeEvent(event.data);
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const localSdp = peerConnection.localDescription?.sdp;

      if (!localSdp) {
        throw new Error("Browser did not create a WebRTC SDP offer.");
      }

      const response = await fetch(`${BACKEND_URL}/realtime-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
        },
        body: localSdp,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      });
      await waitForDataChannelOpen(dataChannel);

      setConnectionState("connected");
      setSpeechState("idle");
    } catch (error) {
      disconnect();
      setConnectionState("error");
      setSpeechState("idle");
      setErrorMessage(formatError(error));
    }
  }

  function disconnect() {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    micStreamRef.current = null;
    audioRef.current?.remove();
    audioRef.current = null;
    clearSpeechRecoveryTimeout();
    clearTurnResolutionTimeout();
    pendingTranscriptRef.current = "";
    setInterimTranscript("");
    setSpeechState("idle");
    setConnectionState("idle");
  }

  function startListening() {
    if (!isConnected) {
      return;
    }

    setErrorMessage("");
    setInterimTranscript("");
    pendingTranscriptRef.current = "";
    clearTurnResolutionTimeout();
    setMicEnabled(true);
    setSpeechState("listening");
  }

  function stopListening() {
    setMicEnabled(false);
    pendingTranscriptRef.current = "";
    clearTurnResolutionTimeout();
    setInterimTranscript("");
    setSpeechState("idle");
  }

  async function handleRealtimeEvent(rawEvent: string) {
    const realtimeEvent = safeJsonParse(rawEvent);

    if (!realtimeEvent) {
      return;
    }

    if (realtimeEvent.type === "input_audio_buffer.speech_started") {
      if (pendingTranscriptRef.current) {
        clearTurnResolutionTimeout();
      }

      setSpeechState("listening");
      return;
    }

    if (
      realtimeEvent.type === "conversation.item.input_audio_transcription.delta" &&
      realtimeEvent.delta
    ) {
      setInterimTranscript((current) => `${current}${realtimeEvent.delta}`);
      return;
    }

    if (
      realtimeEvent.type === "conversation.item.input_audio_transcription.completed" &&
      realtimeEvent.transcript
    ) {
      queueFinalTranscript(realtimeEvent.transcript);
      return;
    }

    if (
      realtimeEvent.type === "response.output_audio.done" ||
      realtimeEvent.type === "response.audio.done" ||
      realtimeEvent.type === "response.done"
    ) {
      clearSpeechRecoveryTimeout();
      setSpeechState("idle");
      return;
    }

    if (realtimeEvent.type === "error") {
      clearSpeechRecoveryTimeout();
      setSpeechState("idle");
      setErrorMessage(realtimeEvent.error?.message ?? "Realtime session error");
    }
  }

  async function handleFinalTranscript(transcript: string) {
    const cleanTranscript = transcript.trim();

    if (!cleanTranscript) {
      return;
    }

    setInterimTranscript("");
    setSpeechState("resolving");
    appendTurn("user", cleanTranscript);

    try {
      const nextDecision = await resolveTurn(cleanTranscript);
      setDecision(nextDecision);
      appendTurn("assistant", nextDecision.approved_text_fi, nextDecision.mode);
      speakApprovedText(nextDecision.approved_text_fi);
    } catch (error) {
      setSpeechState("idle");
      setErrorMessage(formatError(error));
    }
  }

  async function submitDraft() {
    const transcript = draft.trim();

    if (!transcript) {
      return;
    }

    setDraft("");
    stopListening();
    await handleFinalTranscript(transcript);
  }

  function queueFinalTranscript(transcript: string) {
    const cleanTranscript = transcript.trim();

    if (!cleanTranscript) {
      return;
    }

    pendingTranscriptRef.current = [pendingTranscriptRef.current, cleanTranscript]
      .filter(Boolean)
      .join(" ");
    setInterimTranscript(pendingTranscriptRef.current);
    clearTurnResolutionTimeout();

    turnResolutionTimeoutRef.current = window.setTimeout(() => {
      const finalTranscript = pendingTranscriptRef.current.trim();
      pendingTranscriptRef.current = "";
      clearTurnResolutionTimeout();
      setMicEnabled(false);

      if (finalTranscript) {
        void handleFinalTranscript(finalTranscript);
      }
    }, USER_TURN_GRACE_MS);
  }

  async function resolveTurn(transcript: string) {
    const response = await fetch(`${BACKEND_URL}/resolve-turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript,
        session_id: sessionIdRef.current,
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return (await response.json()) as Decision;
  }

  function speakApprovedText(text: string) {
    setSpeechState("speaking");
    startSpeechRecoveryTimeout();
    const dataChannel = dataChannelRef.current;

    if (dataChannel?.readyState === "open") {
      dataChannel.send(
        JSON.stringify({
          type: "response.create",
          response: {
            output_modalities: ["audio"],
            instructions: [
              "Puhu rennolla, luontevalla suomella.",
              "Säilytä alla olevan backend-hyväksytyn tekstin faktat ja tämän vaiheen tarkoitus.",
              "Voit pehmentää sanamuotoa vähän, mutta älä lisää uutta faktaa, uutta vaihetta tai lisäohjetta.",
              "Pidä puhe alle neljässä sekunnissa.",
              `Backend-hyväksytty teksti: ${text}`,
            ].join(" "),
          },
        })
      );
      return;
    }

    setSpeechState("idle");
    setErrorMessage("Realtime data channel is not open. Connect before sending a turn.");
  }

  function startSpeechRecoveryTimeout() {
    clearSpeechRecoveryTimeout();
    speechRecoveryTimeoutRef.current = window.setTimeout(() => {
      setSpeechState("idle");
    }, 10000);
  }

  function clearSpeechRecoveryTimeout() {
    if (speechRecoveryTimeoutRef.current) {
      window.clearTimeout(speechRecoveryTimeoutRef.current);
      speechRecoveryTimeoutRef.current = null;
    }
  }

  function clearTurnResolutionTimeout() {
    if (turnResolutionTimeoutRef.current) {
      window.clearTimeout(turnResolutionTimeoutRef.current);
      turnResolutionTimeoutRef.current = null;
    }
  }

  function setMicEnabled(enabled: boolean) {
    micStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  function appendTurn(speaker: Turn["speaker"], text: string, mode?: DecisionMode) {
    setTurns((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        speaker,
        text,
        mode,
      },
    ]);
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-5 py-5">
        <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted-foreground">Realtime POC</p>
            <h1 className="text-2xl font-semibold tracking-normal">
              Backend-approved voice flow
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge state={connectionState} label={statusCopy[connectionState]} />
            <StatusBadge state={speechState} label={speechCopy[speechState]} />
            <Button onClick={connect} disabled={connectionState === "connecting" || isConnected}>
              <PhoneCallIcon data-icon="inline-start" />
              Connect
            </Button>
            {speechState === "listening" ? (
              <Button variant="outline" onClick={stopListening} disabled={!isConnected}>
                <MicOffIcon data-icon="inline-start" />
                Stop
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => startListening()}
                disabled={!isConnected || speechState === "resolving" || speechState === "speaking"}
              >
                <MicIcon data-icon="inline-start" />
                Listen
              </Button>
            )}
            <Button variant="outline" onClick={disconnect} disabled={!isConnected}>
              <PhoneOffIcon data-icon="inline-start" />
              Disconnect
            </Button>
          </div>
        </header>

        {errorMessage ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        <section className="grid flex-1 gap-5 lg:grid-cols-[1fr_320px]">
          <Card className="min-h-[520px]">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <CardTitle>Transcript</CardTitle>
                  <CardDescription>User turns and approved Finnish replies.</CardDescription>
                </div>
                {speechState === "listening" ? (
                  <Badge variant="secondary">
                    <MicIcon data-icon="inline-start" />
                    Listening
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    <MicOffIcon data-icon="inline-start" />
                    Idle
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex h-full flex-col gap-4">
              <div className="flex min-h-[340px] flex-1 flex-col gap-3 rounded-md border bg-muted/20 p-3">
                {turns.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    Connect, click Listen, then speak in Finnish.
                  </div>
                ) : (
                  turns.map((turn) => (
                    <div
                      key={turn.id}
                      className={cn(
                        "flex max-w-[82%] flex-col gap-1 rounded-md border px-3 py-2 text-sm",
                        turn.speaker === "user"
                          ? "self-start bg-background"
                          : "self-end bg-primary text-primary-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2 text-xs opacity-80">
                        <span>{turn.speaker === "user" ? "User" : "Assistant"}</span>
                        {turn.mode ? <span>{turn.mode}</span> : null}
                      </div>
                      <p>{turn.text}</p>
                    </div>
                  ))
                )}
              </div>

              {interimTranscript ? (
                <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  {interimTranscript}
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Kirjoita testilause, esimerkiksi: En löydä kuittia ostoksesta."
                  className="min-h-20 resize-none"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Debug text turn. Voice input uses OpenAI Realtime transcription.
                  </p>
                  <Button
                    onClick={submitDraft}
                    disabled={!draft.trim() || !isConnected || speechState === "resolving" || speechState === "speaking"}
                  >
                    <SendIcon data-icon="inline-start" />
                    Send
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <aside className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Decision</CardTitle>
                <CardDescription>Backend resolver output.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <DebugRow label="mode" value={decision?.mode ?? "-"} />
                <Separator />
                <DebugRow label="case_id" value={decision?.case_id ?? "-"} />
                <Separator />
                <DebugRow
                  label="confidence"
                  value={decision ? decision.confidence.toFixed(2) : "-"}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Voice layer</CardTitle>
                <CardDescription>Realtime output status.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Volume2Icon className="text-muted-foreground" />
                  <span>
                    {isConnected
                      ? "Realtime audio channel is connected."
                      : "Connect to enable Realtime speech."}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <BadgeCheckIcon className="text-muted-foreground" />
                  <span>Assistant text comes only from the resolver.</span>
                </div>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}

function StatusBadge({
  state,
  label,
}: {
  state: ConnectionState | SpeechState;
  label: string;
}) {
  return (
    <Badge variant={state === "error" ? "destructive" : "secondary"}>
      <CircleDotIcon data-icon="inline-start" />
      {label}
    </Badge>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="break-words text-sm font-medium">{value}</span>
    </div>
  );
}

function safeJsonParse(raw: string): RealtimeEvent | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

function waitForDataChannelOpen(dataChannel: RTCDataChannel) {
  if (dataChannel.readyState === "open") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Realtime data channel did not open."));
    }, 8000);

    dataChannel.addEventListener(
      "open",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );

    dataChannel.addEventListener(
      "error",
      () => {
        window.clearTimeout(timeout);
        reject(new Error("Realtime data channel failed to open."));
      },
      { once: true }
    );
  });
}

export default App;
