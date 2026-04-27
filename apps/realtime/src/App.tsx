import { useEffect, useRef, useState } from "react";
import {
  BadgeCheckIcon,
  CircleDotIcon,
  MicIcon,
  MicOffIcon,
  PhoneCallIcon,
  PhoneOffIcon,
  RotateCcwIcon,
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
  last_topic?: string | null;
  reset_reason?: string | null;
  match_reason?: string | null;
  coverage_tier?: string | null;
};

type Turn = {
  id: string;
  speaker: "user" | "assistant";
  text: string;
  mode?: DecisionMode;
};

type ConnectionState = "idle" | "connecting" | "connected" | "error";
type SpeechState = "idle" | "listening" | "resolving" | "speaking";

type DiagnosticEvent = {
  id: string;
  time: string;
  label: string;
  detail?: string;
};

type RealtimeEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  item?: {
    content?: Array<{
      transcript?: string;
    }>;
  };
  error?: {
    message?: string;
  };
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8787";
const SESSION_STORAGE_KEY = "voice-assistant:realtime-session-id";
const USER_TURN_GRACE_MS = 250;

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
  const [sessionId, setSessionId] = useState(loadSessionId);
  const [diagnosticEvents, setDiagnosticEvents] = useState<DiagnosticEvent[]>([]);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const speechRecoveryTimeoutRef = useRef<number | null>(null);
  const turnResolutionTimeoutRef = useRef<number | null>(null);
  const pendingTranscriptRef = useRef("");
  const pendingAssistantTurnIdRef = useRef<string | null>(null);
  const pendingAssistantTranscriptRef = useRef("");
  const pendingAssistantApprovedTextRef = useRef("");
  const pendingAssistantModeRef = useRef<DecisionMode>("answer");
  const speechStateRef = useRef<SpeechState>("idle");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef(sessionId);

  const isConnected = connectionState === "connected";

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  useEffect(() => {
    speechStateRef.current = speechState;
  }, [speechState]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    persistSessionId(sessionId);
  }, [sessionId]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, interimTranscript]);

  async function connect() {
    setErrorMessage("");
    setConnectionState("connecting");
    addDiagnosticEvent("connect:start", sessionIdRef.current);

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
      setMicEnabled(true);

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
      setSpeechState("listening");
      addDiagnosticEvent("connect:ready", sessionIdRef.current);
    } catch (error) {
      disconnect();
      setConnectionState("error");
      setSpeechState("idle");
      const message = formatError(error);
      setErrorMessage(message);
      addDiagnosticEvent("connect:error", message);
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
    resetPendingAssistant();
    setInterimTranscript("");
    setSpeechState("idle");
    setConnectionState("idle");
    addDiagnosticEvent("disconnect", sessionIdRef.current);
  }

  function resetConversation() {
    const nextSessionId = crypto.randomUUID();
    clearSpeechRecoveryTimeout();
    clearTurnResolutionTimeout();
    pendingTranscriptRef.current = "";
    resetPendingAssistant();
    setTurns([]);
    setDecision(null);
    setDraft("");
    setInterimTranscript("");
    setErrorMessage("");
    sessionIdRef.current = nextSessionId;
    persistSessionId(nextSessionId);
    setSessionId(nextSessionId);
    addDiagnosticEvent("session:reset", nextSessionId);
  }

  async function handleRealtimeEvent(rawEvent: string) {
    const realtimeEvent = safeJsonParse(rawEvent);

    if (!realtimeEvent) {
      return;
    }

    if (realtimeEvent.type === "input_audio_buffer.speech_started") {
      if (speechStateRef.current === "resolving" || speechStateRef.current === "speaking") {
        addDiagnosticEvent("realtime:ignored_user_audio", speechStateRef.current);
        return;
      }

      if (pendingTranscriptRef.current) {
        clearTurnResolutionTimeout();
      }

      setSpeechState("listening");
      addDiagnosticEvent("realtime:speech_started");
      return;
    }

    if (
      realtimeEvent.type === "conversation.item.input_audio_transcription.delta" &&
      realtimeEvent.delta
    ) {
      if (speechStateRef.current === "resolving" || speechStateRef.current === "speaking") {
        addDiagnosticEvent("realtime:ignored_user_transcript", speechStateRef.current);
        return;
      }

      setInterimTranscript((current) => `${current}${realtimeEvent.delta}`);
      return;
    }

    if (
      realtimeEvent.type === "conversation.item.input_audio_transcription.completed" &&
      realtimeEvent.transcript
    ) {
      if (speechStateRef.current === "resolving" || speechStateRef.current === "speaking") {
        addDiagnosticEvent("realtime:ignored_user_final", speechStateRef.current);
        return;
      }

      addDiagnosticEvent("realtime:user_final", realtimeEvent.transcript);
      queueFinalTranscript(realtimeEvent.transcript);
      return;
    }

    if (isAssistantTranscriptDelta(realtimeEvent) && realtimeEvent.delta) {
      updateAssistantSpeechTranscript(realtimeEvent.delta);
      return;
    }

    if (isAssistantTranscriptDone(realtimeEvent)) {
      const transcript = extractAssistantTranscript(realtimeEvent);

      if (transcript) {
        setAssistantSpeechTranscript(transcript);
        addDiagnosticEvent("realtime:assistant_transcript", transcript);
      }

      return;
    }

    if (
      realtimeEvent.type === "response.output_audio.done" ||
      realtimeEvent.type === "response.audio.done" ||
      realtimeEvent.type === "response.done"
    ) {
      clearSpeechRecoveryTimeout();
      flushPendingAssistantFallback();
      setSpeechState(peerConnectionRef.current ? "listening" : "idle");
      addDiagnosticEvent("realtime:response_done");
      return;
    }

    if (realtimeEvent.type === "error") {
      clearSpeechRecoveryTimeout();
      setSpeechState("idle");
      const message = realtimeEvent.error?.message ?? "Realtime session error";
      setErrorMessage(message);
      addDiagnosticEvent("realtime:error", message);
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
      addDiagnosticEvent(
        `resolver:${nextDecision.mode}`,
        [nextDecision.case_id, nextDecision.step_id, nextDecision.match_reason]
          .filter(Boolean)
          .join(" | ")
      );
      speakApprovedText(nextDecision.approved_text_fi, nextDecision.mode);
    } catch (error) {
      setSpeechState("idle");
      const message = formatError(error);
      setErrorMessage(message);
      addDiagnosticEvent("resolver:error", message);
    }
  }

  async function submitDraft() {
    const transcript = draft.trim();

    if (!transcript) {
      return;
    }

    setDraft("");
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

  function speakApprovedText(text: string, mode: DecisionMode) {
    setSpeechState("speaking");
    startSpeechRecoveryTimeout();
    pendingAssistantApprovedTextRef.current = text;
    pendingAssistantModeRef.current = mode;
    const dataChannel = dataChannelRef.current;

    if (dataChannel?.readyState === "open") {
      dataChannel.send(
        JSON.stringify({
          type: "response.create",
          response: {
            output_modalities: ["audio"],
            instructions: [
              "Puhu rennolla, luontevalla suomella.",
              "Sano alla oleva backend-hyväksytty teksti mahdollisimman täsmällisesti.",
              "Älä lisää uutta faktaa, uutta vaihetta tai lisäohjetta.",
              "Pidä puhe alle neljässä sekunnissa.",
              `Backend-hyväksytty teksti: ${text}`,
            ].join(" "),
          },
        })
      );
      return;
    }

    resetPendingAssistant();
    setSpeechState("idle");
    setErrorMessage("Realtime data channel is not open. Connect before sending a turn.");
    addDiagnosticEvent("realtime:error", "Data channel is not open");
  }

  function startSpeechRecoveryTimeout() {
    clearSpeechRecoveryTimeout();
    speechRecoveryTimeoutRef.current = window.setTimeout(() => {
      flushPendingAssistantFallback();
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
    const id = crypto.randomUUID();

    setTurns((current) => [
      ...current,
      {
        id,
        speaker,
        text,
        mode,
      },
    ]);

    return id;
  }

  function updateTurn(turnId: string, text: string) {
    setTurns((current) =>
      current.map((turn) => (turn.id === turnId ? { ...turn, text } : turn))
    );
  }

  function updateAssistantSpeechTranscript(delta: string) {
    if (!pendingAssistantApprovedTextRef.current) {
      return;
    }

    pendingAssistantTranscriptRef.current += delta;
    const turnId = ensurePendingAssistantTurn();
    updateTurn(turnId, pendingAssistantTranscriptRef.current);
  }

  function setAssistantSpeechTranscript(transcript: string) {
    if (!pendingAssistantApprovedTextRef.current) {
      return;
    }

    pendingAssistantTranscriptRef.current = transcript.trim();

    if (!pendingAssistantTranscriptRef.current) {
      return;
    }

    const turnId = ensurePendingAssistantTurn();
    updateTurn(turnId, pendingAssistantTranscriptRef.current);
  }

  function ensurePendingAssistantTurn() {
    if (!pendingAssistantTurnIdRef.current) {
      pendingAssistantTurnIdRef.current = appendTurn(
        "assistant",
        "",
        pendingAssistantModeRef.current
      );
    }

    return pendingAssistantTurnIdRef.current;
  }

  function flushPendingAssistantFallback() {
    if (!pendingAssistantApprovedTextRef.current) {
      resetPendingAssistant();
      return;
    }

    if (!pendingAssistantTranscriptRef.current.trim()) {
      const turnId = ensurePendingAssistantTurn();
      updateTurn(turnId, pendingAssistantApprovedTextRef.current);
    }

    resetPendingAssistant();
  }

  function resetPendingAssistant() {
    pendingAssistantTurnIdRef.current = null;
    pendingAssistantTranscriptRef.current = "";
    pendingAssistantApprovedTextRef.current = "";
    pendingAssistantModeRef.current = "answer";
  }

  function addDiagnosticEvent(label: string, detail?: string) {
    setDiagnosticEvents((current) =>
      [
        {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString("fi-FI", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          label,
          detail,
        },
        ...current,
      ].slice(0, 8)
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-background">
      <div className="mx-auto flex h-screen w-full max-w-7xl flex-col gap-5 px-5 py-5">
        <header className="flex flex-none flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
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
            <Button variant="outline" onClick={disconnect} disabled={!isConnected}>
              <PhoneOffIcon data-icon="inline-start" />
              Disconnect
            </Button>
            <Button
              variant="outline"
              onClick={resetConversation}
              disabled={speechState === "resolving" || speechState === "speaking"}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Reset memory
            </Button>
          </div>
        </header>

        {errorMessage ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        <section className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px_320px]">
          <Card className="flex min-h-0 flex-col">
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
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
              <div
                ref={chatScrollRef}
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border bg-muted/20 p-3"
              >
                {turns.length === 0 && !interimTranscript ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    Connect, allow the microphone, then speak in Finnish.
                  </div>
                ) : (
                  <>
                    {turns.map((turn) => (
                      <div
                        key={turn.id}
                        className={cn(
                          "flex max-w-[82%] flex-col gap-1 border px-4 py-3 text-sm leading-relaxed shadow-sm",
                          turn.speaker === "user"
                            ? "self-start rounded-[1.6rem] rounded-bl-md bg-background"
                            : "self-end rounded-[1.6rem] rounded-br-md bg-primary text-primary-foreground"
                        )}
                      >
                        <div className="flex items-center gap-2 text-xs opacity-80">
                          <span>{turn.speaker === "user" ? "User" : "Assistant"}</span>
                          {turn.mode ? <span>{turn.mode}</span> : null}
                        </div>
                        <p>{turn.text}</p>
                      </div>
                    ))}
                    {interimTranscript ? (
                      <div className="max-w-[82%] self-start rounded-[1.6rem] rounded-bl-md border border-dashed bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                        {interimTranscript}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <div className="flex flex-none flex-col gap-2">
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

          <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
            <Card>
              <CardHeader>
                <CardTitle>Decision</CardTitle>
                <CardDescription>Backend resolver continuity.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <DebugRow label="session_id" value={decision?.session_id ?? sessionId} />
                <Separator />
                <DebugRow label="mode" value={decision?.mode ?? "-"} />
                <Separator />
                <DebugRow label="case_id" value={decision?.case_id ?? "-"} />
                <Separator />
                <DebugRow label="step_id" value={decision?.step_id ?? "-"} />
                <Separator />
                <DebugRow
                  label="awaits_confirmation"
                  value={formatDebugValue(decision?.awaits_confirmation)}
                />
                <Separator />
                <DebugRow
                  label="confidence"
                  value={decision ? decision.confidence.toFixed(2) : "-"}
                />
                <Separator />
                <DebugRow label="last_topic" value={decision?.last_topic ?? "-"} />
                <Separator />
                <DebugRow label="coverage_tier" value={decision?.coverage_tier ?? "-"} />
                <Separator />
                <DebugRow label="reset_reason" value={decision?.reset_reason ?? "-"} />
                <Separator />
                <DebugRow label="match_reason" value={decision?.match_reason ?? "-"} />
              </CardContent>
            </Card>
          </aside>

          <aside className="flex min-h-0 flex-col gap-5 overflow-hidden">
            <Card className="flex min-h-0 flex-[1.6] flex-col">
              <CardHeader>
                <CardTitle>Event log</CardTitle>
                <CardDescription>Session and Realtime diagnostics.</CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2 text-xs">
                {diagnosticEvents.length === 0 ? (
                  <span className="text-muted-foreground">No events yet.</span>
                ) : (
                  diagnosticEvents.map((event) => (
                    <div key={event.id} className="rounded-md border bg-muted/20 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{event.label}</span>
                        <span className="text-muted-foreground">{event.time}</span>
                      </div>
                      {event.detail ? (
                        <p className="mt-1 break-words text-muted-foreground">{event.detail}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="flex-none">
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
                  <span>Assistant audio is resolver-approved.</span>
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

function formatDebugValue(value: boolean | string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function loadSessionId() {
  try {
    const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY)?.trim();

    if (storedSessionId) {
      return storedSessionId;
    }
  } catch {
    // Keep local dev resilient if storage is unavailable.
  }

  return crypto.randomUUID();
}

function persistSessionId(sessionId: string) {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Session continuity falls back to the current React state.
  }
}

function isAssistantTranscriptDelta(realtimeEvent: RealtimeEvent) {
  return Boolean(
    realtimeEvent.type?.includes("response.") &&
      realtimeEvent.type.includes("audio") &&
      realtimeEvent.type.includes("transcript") &&
      realtimeEvent.type.endsWith(".delta")
  );
}

function isAssistantTranscriptDone(realtimeEvent: RealtimeEvent) {
  return Boolean(
    realtimeEvent.type?.includes("response.") &&
      realtimeEvent.type.includes("audio") &&
      realtimeEvent.type.includes("transcript") &&
      realtimeEvent.type.endsWith(".done")
  );
}

function extractAssistantTranscript(realtimeEvent: RealtimeEvent) {
  const contentTranscript = realtimeEvent.item?.content
    ?.map((content) => content.transcript)
    .filter(Boolean)
    .join(" ");

  return realtimeEvent.transcript ?? contentTranscript ?? "";
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
