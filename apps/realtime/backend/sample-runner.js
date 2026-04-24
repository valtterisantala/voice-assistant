const samples = require("./samples/turns.json");
const { resolveTurn } = require("./resolver");

for (const sample of samples) {
  console.log(`\n# ${sample.name}`);
  console.log(
    JSON.stringify(
      resolveTurn(sample.transcript, {
        session_id: sample.session_id ?? sample.name,
      }),
      null,
      2
    )
  );
}
