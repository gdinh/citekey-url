/* bootstrap.js
 * Zotero 8 plugin:
 *   zotero://better-zotero-urls/select/item-by-citekey/<CITEKEY>[?libraryID=1]
 *
 * Key points:
 * - Use await s.search() (Zotero API docs).
 * - Do NOT call Zotero.launchURL("zotero://select/...") to avoid Gecko external-protocol prompt.
 */

let _origLaunchURL = null;

function install(data, reason) {}
function uninstall(data, reason) {}

function notifyNotFound(citekey) {
  try {
    // Common transient notification mechanism used by many plugins
    // (ProgressWindow-style toast). [web:139]
    const pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.changeHeadline("Citekey URL");
    pw.addDescription(`Citation key not found: ${citekey}`);
    pw.show();
    pw.startCloseTimer(4000);
  } catch (e) {
    // Fallback: don't break flow if notification API differs
    Zotero.debug(`Citekey URL: notify failed: ${String(e)}`);
  }
}

function startup(data, reason) {
  Zotero.debug("Citekey URL: startup");

  _origLaunchURL = Zotero.launchURL.bind(Zotero);

  Zotero.launchURL = function (url, ...rest) {
    if (typeof url !== "string") return _origLaunchURL(url, ...rest);

    const match = parseCitekeyURL(url);
    if (!match) return _origLaunchURL(url, ...rest);

    // Handle asynchronously; return immediately to caller
    (async () => {
      try {
        const item = await findItemByCitationKey(
          match.citekey,
          match.libraryID,
        );
        if (!item) {
          Zotero.debug(`Select by Citekey: not found: ${match.citekey}`);
          notifyNotFound(match.citekey);
          return;
        }
        await selectItemInUI(item);
      } catch (e) {
        Zotero.debug(`Citekey URL: search error: ${String(e)}`);
      }
    })();

    return;
  };
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;

  Zotero.debug("Citekey URL: shutdown");

  if (_origLaunchURL) {
    Zotero.launchURL = _origLaunchURL;
    _origLaunchURL = null;
  }
}

function parseCitekeyURL(spec) {
  // Change prefix to change the URL schema
  // Recommend not trying to override the default zotero://select
  // funny stuff may happen
  const prefix = "zotero://citekey/select/";
  if (!spec.startsWith(prefix)) return null;

  const rest = spec.substring(prefix.length);
  const qmark = rest.indexOf("?");
  const raw = qmark === -1 ? rest : rest.substring(0, qmark);
  const query = qmark === -1 ? "" : rest.substring(qmark + 1);

  const citekey = decodeURIComponent(raw).trim();
  if (!citekey) return null;

  let libraryID = null;
  if (query) {
    const params = new URLSearchParams(query);
    const lib = params.get("libraryID");
    if (lib) {
      const parsed = parseInt(lib, 10);
      if (!Number.isNaN(parsed)) libraryID = parsed;
    }
  }

  return { citekey, libraryID };
}

async function findItemByCitationKey(citekey, libraryID) {
  const wanted = (citekey || "").trim();
  if (!wanted) return null;

  const wantedLower = wanted.toLowerCase();

  const libs =
    libraryID != null
      ? [Zotero.Libraries.get(libraryID)]
      : Zotero.Libraries.getAll();

  for (const lib of libs) {
    if (!lib) continue;

    // 1) Case-sensitive exact match
    {
      const s = new Zotero.Search();
      s.libraryID = lib.libraryID;
      s.addCondition("citationKey", "is", wanted);

      const ids = await s.search(); // async per Zotero JS API
      if (ids && ids.length) {
        for (const id of ids) {
          const item = Zotero.Items.get(id);
          if (item && (item.getField("citationKey") || "") === wanted)
            return item;
        }
      }
    }

    // 2) Case-insensitive exact match (fallback):
    // do a wider search then filter in JS
    {
      const s = new Zotero.Search();
      s.libraryID = lib.libraryID;

      // 'contains' is broader; we filter down to exact-insensitive match ourselves.
      s.addCondition("citationKey", "contains", wanted);

      const ids = await s.search(); // async per Zotero JS API
      if (!ids || !ids.length) continue;

      for (const id of ids) {
        const item = Zotero.Items.get(id);
        const ck = item ? item.getField("citationKey") || "" : "";
        if (ck && ck.toLowerCase() === wantedLower) return item;
      }
    }
  }

  return null;
}

async function selectItemInUI(item) {
  // Bring Zotero to front (best-effort)
  try {
    const wm = Services.wm; // might not exist; don't rely on it
    void wm;
  } catch (e) {}

  // Use the active Zotero pane to select the item
  const zp = Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane();
  if (!zp) {
    // Fallback: try main window
    const win = Zotero.getMainWindow && Zotero.getMainWindow();
    if (!win || !win.ZoteroPane) return;
    return win.ZoteroPane.selectItem(item.id);
  }

  // Ensure correct library selected, then select item
  try {
    zp.setSelectedLibraryID(item.libraryID);
  } catch (e) {
    // Some builds select implicitly; ignore
  }

  // selectItem is the common pane API; if missing, try selectItems
  if (zp.selectItem) {
    return zp.selectItem(item.id);
  }
  if (zp.selectItems) {
    return zp.selectItems([item.id]);
  }
}
