# Citekey URLs for Zotero

This plugin lets you link directly to Zotero items using their BibTeX citation keys. For instance, if you have a paper whose citekey is `VSP+17-Attention`, you can link directly to it using `zotero://citekey/select/VSP+17-Attention`.

This plugin is meant to be used with [Better BibTeX](https://retorque.re/zotero-better-bibtex/), which defines stable, unique BibTeX keys.

There is no UI or configuration interface. If you'd like to change the URL scheme, change the line

```
const prefix = "zotero://citekey/select/";
```

in the code to the prefix of a URL scheme of your choosing.

The assumption is that there is a top-level field called `citationKey`, which exists with Zotero 8 and Better BibTeX. Certain older versions of Zotero/BBT would store the citation key in the Extra field; these are not supported.

## Build instructions

```
zip -r citekey-url.xpi manifest.json bootstrap.js
```

## Disclaimer

This was thrown together in an hour (largely with vibe coding) to scratch a personal itch. I have very little knowledge of Zotero's internals or plugin architecture, and make no guarantees about the robustness of this plugin. Use at your own risk.
