# Game Preview

An [Obsidian](https://obsidian.md) plugin that renders rich game cards from Steam and itch.io URLs — showing the title, description, and screenshots inline in your notes.

## How it works

Paste a bare Steam or itch.io URL on its own line and the plugin replaces it with a game card showing the title, a short description, and up to three screenshots.

- In **Live Preview**, the card renders in place of the URL. When your cursor is on the URL line, the raw URL stays visible with the card appearing below it.
- In **Reading view**, the card replaces the link entirely.

## Supported URLs

- `https://store.steampowered.com/app/<id>/...`
- `https://<creator>.itch.io/<game>`

## Example

```
https://store.steampowered.com/app/1716740/Dome_Keeper/
```

Renders as a card with the game title, description, and screenshots.

## Installation

This plugin is not yet in the Obsidian community plugin directory. To install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/thatnzguy/obsidian-game-preview/releases).
2. Copy them into your vault at `.obsidian/plugins/game-preview/`.
3. Enable the plugin in **Settings → Community plugins**.
