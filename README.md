# AI Avatar

A little animated character that lives on your Mac desktop. He naps in the corner until you tap him. Then he wakes up and asks **"What do you need me to find?"** Type something like *"my resume pdf from last month"*. He walks off to the corner to search, then comes back with your files.

## Run it

```bash
npm install
npm start
```

- **Tap** the avatar to wake him; tap again or press **Esc** to put him back to sleep.
- **Drag** him anywhere on screen.
- **Right-click** him to quit.
- Click a result to open it, or 📂 to show it in Finder.

## Making the search smart (free)

He understands plain English using whichever of these is available, in this order:

1. **Local AI with Ollama (recommended, free, private, offline)**
   ```bash
   brew install ollama
   ollama serve &
   ollama pull qwen2.5:3b
   ```
   Use another model with `OLLAMA_MODEL=llama3.2:3b npm start`.
2. **Gemini free tier:** get a key at Google AI Studio, then run `GEMINI_API_KEY=... npm start`.
3. **Basic mode:** built-in keyword and date rules. These always work, even with no AI.

Only the sentence you type goes to the AI. Your files never leave your Mac. The search itself uses macOS Spotlight.

## Make him look like you

Change the colours at the top of [static/style.css](static/style.css) (skin, hair, shirt, glasses). The character itself is the SVG in [static/index.html](static/index.html).

## Develop

```bash
npm test   # build + unit tests
```
