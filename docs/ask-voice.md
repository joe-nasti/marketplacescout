# Ask Collectish voice

## Shipped capture path

Ask records a bounded question in the browser or Android WebView, sends the audio to the authenticated `ask-collectish-transcribe` Edge Function, and places the result back into the normal Ask composer as an editable draft. It never auto-submits.

The endpoint uses `gpt-transcribe` with:

- fixed Magic: The Gathering, marketplace, condition, and treatment vocabulary;
- the currently selected Scout product as request-specific context;
- explicit preservation of prices, quantities, percentages, collector numbers, and foil state;
- a stable privacy-preserving safety identifier derived from the authenticated user ID.

Audio is forwarded in-memory to the transcription API and is not written to Collectish storage. Client recording stops after 90 seconds, uploads are capped at 12 MiB, and closing Ask cancels recording or transcription.

## Delvin reuse

The transcription function accepts a `client` field and returns transport-neutral text, so linked Delvin users can reuse the same recognition layer. Discord does not provide a ChatGPT-style microphone control inside a slash-command text field. The practical first Delvin voice surface is an audio attachment or voice-message command that:

1. refreshes the linked user's Collectish OAuth token;
2. downloads the bounded Discord audio attachment;
3. calls `ask-collectish-transcribe` with `client=discord`;
4. shows the transcript for confirmation or clearly labels it before routing it through the shared Ask API.

Guest voice should remain disabled until it has an explicit abuse and cost limit.

## Live Delvin

Live mode is a separate realtime transport, not an extension of the recorder button. Start it inside Collectish with a browser/mobile WebRTC session and keep Collectish lookup tools on the server side.

The first tool set should be deliberately narrow and fast:

- exact card and printing identity resolution;
- current TCG Market, Low, Direct Low, and supply;
- Card Kingdom buylist and ManaPool executable depth when available;
- short Scout verdict and the age of the underlying data.

The spoken loop must support interruption, visible transcripts, cancellation, and explicit ambiguity handling. If Delvin cannot distinguish a printing, condition, language, or foil state, it should ask one short spoken follow-up rather than guess. Deeper research and long historical analysis should hand off to normal Ask instead of blocking the live conversation.
