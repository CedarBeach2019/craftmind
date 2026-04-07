# CraftMind

You log into your Minecraft survival server. Somebody's already there. They chopped the oak by spawn, built a tiny lean-to, left you bread in a chest. That's not your friend. That's CraftMind.

It is an autonomous AI player that logs in, survives, and plays like a person. It runs entirely on your infrastructure, with no closed APIs or paywalls. You own every part.

## Why This Exists
Most Minecraft bots are either simple scripts or locked demos. You get an agent that you can actually leave on your server, modify, and trust. This is not a marketing stunt.

## 🚀 Quick Start
This is a fork-first project. To run your own agent:
1.  Fork this repository.
2.  Deploy it to Cloudflare Workers or any Node runtime.
3.  Add your server IP and LLM API key as environment variables.

The agent will connect in about 90 seconds. There are zero runtime dependencies.

## How It's Different
1.  **Your Infrastructure:** It never runs on our servers. You deploy it. We never see your world or your keys.
2.  **No Hardcoded Scripts:** Every action is decided live by an LLM. You can read its plain-text reasoning logs.
3.  **Plays Fair:** It obeys standard game mechanics. It won't glitch through blocks or cheat movement. It dies to creepers.

## Features
*   Connects to modern survival servers using the standard protocol.
*   Maintains basic memory of places and conversations across restarts.
*   You can add custom behaviors with short, simple plugins.
*   Produces transparent logs of every decision it makes.

**An Honest Limitation:** It processes about 2-3 actions per second. It will not operate at superhuman speeds and may pause to "think" for several seconds on complex tasks.

## Configuration
All configuration is done through environment variables. No config files are committed. It works with OpenAI, Anthropic, and other compatible LLM providers.

## Try the Demo
You can watch a live instance playing on the public test server:  
[https://the-fleet.casey-digennaro.workers.dev](https://the-fleet.casey-digennaro.workers.dev)

## Contributing
Fork the repository first. Build something for your own server. If you create a useful modification, open a pull request.

## 📄 License
MIT License

<div style="text-align:center;padding:16px;color:#64748b;font-size:.8rem"><a href="https://the-fleet.casey-digennaro.workers.dev" style="color:#64748b">The Fleet</a> &middot; <a href="https://cocapn.ai" style="color:#64748b">Cocapn</a></div>