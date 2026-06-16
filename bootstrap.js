/* bootstrap.js
 * Zotero 9 plugin:
 *   zotero://citekey/select/<CITEKEY>[?libraryID=1]
 *
 * Key points:
 * - Use await s.search() (Zotero API docs).
 * - Do NOT call Zotero.launchURL("zotero://select/...") to avoid Gecko external-protocol prompt.
 */

let _origLaunchURL = null;
// Change prefix to change the URL schema
// Recommend not trying to override the default zotero://select
// funny stuff may happen
const citekey_url_prefix = "zotero://citekey/select/";

let _addedMenuitem = null;
let _menuDoc = null;

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

function addCitekeyURLContextMenuItem() {
  const win = Zotero.getMainWindow && Zotero.getMainWindow();
  if (!win || !win.document) return;

  const doc = win.document;
  const menu = doc.getElementById("zotero-itemmenu");
  if (!menu) return;

  // Avoid duplicates on reload
  const existing = doc.getElementById("copy-citekey-link");
  if (existing) return;

  const XUL_NS =
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

  const mi = doc.createElementNS(XUL_NS, "menuitem");
  mi.id = "copy-citekey-link";
  mi.setAttribute("label", "Copy citekey link");
  mi.addEventListener("command", () => copyCitekeyURLForSelection());

  // Optional: only show when exactly one regular item is selected
  mi.addEventListener("popupshowing", () => {
    try {
      const zp = win.ZoteroPane;
      const items = zp ? zp.getSelectedItems() : [];
      const ok =
        items &&
        items.length === 1 &&
        items[0] &&
        items[0].isRegularItem &&
        items[0].isRegularItem();
      mi.hidden = !ok;
    } catch (e) {
      mi.hidden = false;
    }
  });

  menu.appendChild(mi);

  _addedMenuitem = mi;
  _menuDoc = doc;
}

function removeCitekeyURLContextMenuItem() {
  try {
    if (_addedMenuitem && _addedMenuitem.parentNode) {
      _addedMenuitem.parentNode.removeChild(_addedMenuitem);
    }
  } catch (e) {}

  _addedMenuitem = null;
  _menuDoc = null;
}

function copyCitekeyURLForSelection() {
  const win = Zotero.getMainWindow();
  const zp = win && win.ZoteroPane;
  if (!zp) return;

  const items = zp.getSelectedItems();
  if (!items || items.length !== 1) return;

  const item = items[0];
  const citekey = (item.getField("citationKey") || "").trim();
  if (!citekey) {
    notifyNotFound("(no citation key on item)");
    return;
  }

  const url = `${citekey_url_prefix}${encodeURIComponent(citekey)}`;

  // Copy to clipboard (standard XUL/Gecko approach)
  // Use the window's navigator clipboard helper if available.
  if (win.navigator && win.navigator.clipboard && win.isSecureContext) {
    // Might not be available/allowed in chrome; try anyway
    win.navigator.clipboard
      .writeText(url)
      .catch(() => Zotero.Utilities.Internal.copyTextToClipboard(url));
  } else {
    // Zotero has internal clipboard helper
    Zotero.Utilities.Internal.copyTextToClipboard(url);
  }

  // Optional: temporary notification
  // try {
  //   const pw = new Zotero.ProgressWindow({ closeOnClick: true });
  //   pw.changeHeadline("Select by Citekey");
  //   pw.addDescription("Citekey link copied to clipboard");
  //   pw.show();
  //   pw.startCloseTimer(2500);
  // } catch (e) {}
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

  addCitekeyURLContextMenuItem();
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;

  Zotero.debug("Citekey URL: shutdown");

  if (_origLaunchURL) {
    Zotero.launchURL = _origLaunchURL;
    _origLaunchURL = null;
  }

  removeCitekeyURLContextMenuItem();
}

function parseCitekeyURL(spec) {
  if (!spec.startsWith(citekey_url_prefix)) return null;

  const rest = spec.substring(citekey_url_prefix.length);
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
