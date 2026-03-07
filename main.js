const { Plugin, requestUrl } = require('obsidian');
const { ViewPlugin, Decoration, WidgetType } = require('@codemirror/view');
const { RangeSetBuilder } = require('@codemirror/state');

const STEAM_RE = /^https?:\/\/store\.steampowered\.com\/app\/\d+/;
const ITCH_RE  = /^https?:\/\/[^/]+\.itch\.io\//;

function isGameUrl(url) {
    return STEAM_RE.test(url) || ITCH_RE.test(url);
}

// ---------------------------------------------------------------------------
// CM6 Widget — renders a game card in place of a bare URL line
// ---------------------------------------------------------------------------

class GameCardWidget extends WidgetType {
    constructor(url, plugin) {
        super();
        this.url    = url;
        this.plugin = plugin;
    }

    eq(other) {
        return this.url === other.url;
    }

    // Prevent clicks from moving the cursor to the URL line (like Obsidian embeds).
    // Links still work — the browser handles <a> clicks independently of CM6.
    ignoreEvent() { return true; }

    toDOM() {
        // document.createElement is required here — CM6's WidgetType.toDOM() must
        // return a plain DOM element synchronously. Obsidian's createEl helpers are
        // available on it because Obsidian patches HTMLElement.prototype globally.
        const el = document.createElement('div');

        const cached = this.plugin.cache.get(this.url);
        if (cached) {
            this.plugin.renderCard(el, { ...cached, url: this.url });
        } else {
            el.className = 'game-preview-loading';
            el.textContent = 'Loading…';

            // async IIFE so we can use await while keeping toDOM() synchronous
            (async () => {
                try {
                    const data = await (STEAM_RE.test(this.url)
                        ? this.plugin.fetchSteam(this.url)
                        : this.plugin.fetchItch(this.url));
                    this.plugin.cache.set(this.url, data);
                    el.className = '';
                    el.empty();
                    this.plugin.renderCard(el, { ...data, url: this.url });
                } catch (e) {
                    el.className = 'game-preview-error';
                    el.textContent = 'Could not load game info: ' + e.message;
                }
            })();
        }

        return el;
    }
}

// ---------------------------------------------------------------------------
// CM6 ViewPlugin — replaces matching lines with widgets (hides when cursor is on the line)
// ---------------------------------------------------------------------------

function buildEditorPlugin(plugin) {
    return ViewPlugin.fromClass(
        class {
            constructor(view) {
                this.decorations = this.build(view);
            }

            update(update) {
                if (update.docChanged || update.selectionSet || update.viewportChanged) {
                    this.decorations = this.build(update.view);
                }
            }

            build(view) {
                const builder  = new RangeSetBuilder();
                const { doc, selection } = view.state;
                const cursorPos = selection.main.head;

                for (const { from, to } of view.visibleRanges) {
                    let pos = from;
                    while (pos <= to) {
                        const line = doc.lineAt(pos);
                        const text = line.text.trim();

                        // Only replace when cursor is not on this line
                        const cursorOnLine = cursorPos >= line.from && cursorPos <= line.to;

                        if (!cursorOnLine && isGameUrl(text)) {
                            builder.add(
                                line.from,
                                line.to,
                                Decoration.replace({
                                    widget: new GameCardWidget(text, plugin),
                                })
                            );
                        }

                        pos = line.to + 1;
                    }
                }

                return builder.finish();
            }
        },
        { decorations: v => v.decorations }
    );
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

class GamePreviewPlugin extends Plugin {
    async onload() {
        this.cache = new Map();

        // Live Preview (editor mode)
        this.registerEditorExtension(buildEditorPlugin(this));

        // Reading view
        this.registerMarkdownPostProcessor(async (el, ctx) => {
            for (const p of el.querySelectorAll('p')) {
                const links = p.querySelectorAll('a');
                if (links.length !== 1) continue;
                const link = links[0];
                if (p.textContent.trim() !== link.textContent.trim()) continue;

                const url = link.href;
                if (!isGameUrl(url)) continue;

                const container = el.createDiv({ cls: 'game-preview-loading', text: 'Loading…' });
                p.replaceWith(container);

                try {
                    let data = this.cache.get(url);
                    if (!data) {
                        data = STEAM_RE.test(url)
                            ? await this.fetchSteam(url)
                            : await this.fetchItch(url);
                        this.cache.set(url, data);
                    }
                    container.empty();
                    container.removeClass('game-preview-loading');
                    this.renderCard(container, { ...data, url });
                } catch (e) {
                    container.empty();
                    container.removeClass('game-preview-loading');
                    this.renderError(container, 'Could not load game info: ' + e.message);
                }
            }
        });
    }

    // --- Fetch ---

    async fetchSteam(url) {
        const match = url.match(/\/app\/(\d+)/);
        if (!match) throw new Error('No Steam App ID found in URL.');

        const res   = await requestUrl({
            url: `https://store.steampowered.com/api/appdetails?appids=${match[1]}&cc=us&l=en`,
        });
        const entry = res.json[match[1]];
        if (!entry?.success) throw new Error('Steam returned no data for this app.');

        const g = entry.data;
        return {
            title:       g.name,
            description: g.short_description,
            images:      (g.screenshots || []).slice(0, 3).map(s => s.path_thumbnail),
            source:      'steam',
        };
    }

    async fetchItch(url) {
        const res  = await requestUrl({ url });
        const html = res.text;

        return {
            title:       this.decodeEntities(this.getMeta(html, 'og:title') || this.getMeta(html, 'twitter:title') || 'Unknown Game'),
            description: this.decodeEntities(this.getMeta(html, 'og:description') || ''),
            images:      this.extractItchImages(html).slice(0, 3),
            source:      'itch',
        };
    }

    // --- Helpers ---

    getMeta(html, property) {
        const patterns = [
            new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
            new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
            new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
            new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m) return m[1];
        }
        return null;
    }

    extractItchImages(html) {
        const images = [], seen = new Set();

        const add = (src) => {
            if (!src || seen.has(src)) return;
            if (src.startsWith('//')) src = 'https:' + src;
            if (!src.startsWith('http')) return;
            seen.add(src); images.push(src);
        };

        for (const s of html.match(/class=["'][^"']*screenshot[^"']*["'][^>]*>[\s\S]*?<\/(?:div|a)>/gi) || []) {
            for (const m of s.matchAll(/<img[^>]+src=["']([^"']+)["']/gi))         add(m[1]);
            for (const m of s.matchAll(/data-(?:src|lazy_src)=["']([^"']+)["']/gi)) add(m[1]);
        }

        if (images.length < 3)
            for (const m of html.matchAll(/["'](https?:\/\/img\.itch\.zone\/[^"']+\.(?:jpg|jpeg|png|gif|webp)[^"']*?)["']/gi))
                add(m[1]);

        if (images.length === 0) {
            const og = this.getMeta(html, 'og:image');
            if (og) add(og);
        }

        return images;
    }

    decodeEntities(str) {
        return str
            .replace(/&amp;/g,  '&')
            .replace(/&lt;/g,   '<')
            .replace(/&gt;/g,   '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g,  "'")
            .replace(/&nbsp;/g, ' ');
    }

    // --- Render ---

    renderCard(el, { title, description, images, url, source }) {
        const card   = el.createDiv({ cls: 'game-preview-card' });
        const header = card.createDiv({ cls: 'game-preview-header' });

        const a = header.createEl('a', { cls: 'game-preview-title', text: title, href: url });
        a.setAttr('target', '_blank');
        a.setAttr('rel', 'noopener noreferrer');

        header.createSpan({
            cls:  `game-preview-badge game-preview-badge--${source}`,
            text: source === 'steam' ? 'Steam' : 'itch.io',
        });

        if (description)
            card.createEl('p', { cls: 'game-preview-description', text: description });

        if (images.length > 0) {
            const gallery = card.createDiv({ cls: 'game-preview-gallery' });
            for (const src of images) {
                const img = gallery.createEl('img', { cls: 'game-preview-image' });
                img.setAttr('src', src);
                img.setAttr('alt', title);
                img.setAttr('loading', 'lazy');
            }
        }
    }

    renderError(el, message) {
        el.createDiv({ cls: 'game-preview-error', text: message });
    }
}

module.exports = GamePreviewPlugin;
