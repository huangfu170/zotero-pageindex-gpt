import { config } from "../package.json";
import { getString, initLocale } from "./modules/locale";
import Views from "./modules/views";
import Utils from "./modules/utils";
import { initValidation } from "./validation/core";

const initializedWindows = new WeakSet<Window>();

function bindMainWindow(win: Window) {
  _globalThis.__bindMainWindow?.(win);
}

function registerToolsMenu(win: Window) {
  const menuId = `${config.addonRef}-open-window`;
  const doc = win.document;
  doc.querySelector(`#${menuId}`)?.remove();
  const menuPopup = doc.querySelector("#menu_ToolsPopup");
  if (!menuPopup) {
    ztoolkit.log("Tools menu popup not found");
    return;
  }
  const menuItem = (doc as any).createXULElement("menuitem");
  menuItem.id = menuId;
  menuItem.setAttribute("label", config.addonName);
  menuItem.setAttribute("class", "menuitem-iconic");
  menuItem.setAttribute("image", `chrome://${config.addonRef}/content/icons/favicon.png`);
  menuItem.addEventListener("command", () => {
    bindMainWindow(win);
    Zotero[config.addonInstance].views.show();
  });
  menuPopup.appendChild(menuItem);
}

async function onStartup() {
  Zotero.Prefs.set(
    `${config.addonRef}.diagnosticStage`,
    `hooks-startup:${Date.now()}`
  );
  initValidation(config.addonRef); 
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();
  ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`
  );

  Zotero[config.addonInstance].utils = new Utils();

  const windows =
    typeof Zotero.getMainWindows === "function"
      ? Zotero.getMainWindows()
      : [Zotero.getMainWindow()].filter(Boolean);
  await Promise.all(windows.map((win) => onMainWindowLoad(win)));
  Zotero.Prefs.set(
    `${config.addonRef}.diagnosticStage`,
    `hooks-startup-complete:${Date.now()}`
  );
  ztoolkit.log(`${config.addonName} startup completed`);
}

async function onMainWindowLoad(win: Window) {
  if (initializedWindows.has(win)) {
    return;
  }
  initializedWindows.add(win);
  bindMainWindow(win);
  Zotero.Prefs.set(
    `${config.addonRef}.diagnosticStage`,
    `main-window-load:${Date.now()}`
  );

  Zotero[config.addonInstance].views = new Views();

  try {
    registerToolsMenu(win);
  } catch (error) {
    ztoolkit.log("Failed to register tools menu", error);
  }
  ztoolkit.log(`${config.addonName} main window loaded`);
}

async function onMainWindowUnload(win: Window) {
  initializedWindows.delete(win);
  win.document.querySelector(`#${config.addonRef}-open-window`)?.remove();
  win.document.querySelector(`#${config.addonRef}-style`)?.remove();
  win.document.querySelector(`#${config.addonRef}-link`)?.remove();
  win.document.querySelector("#zotero-GPT-container")?.remove();
}

function onShutdown(): void {
  Zotero.getMainWindows?.().forEach((win) => {
    win.document.querySelector(`#${config.addonRef}-open-window`)?.remove();
    win.document.querySelector(`#${config.addonRef}-style`)?.remove();
    win.document.querySelector(`#${config.addonRef}-link`)?.remove();
    win.document.querySelector("#zotero-GPT-container")?.remove();
  });
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  delete Zotero[config.addonInstance];
}

export default {
  onStartup,
  onMainWindowLoad,
  onMainWindowUnload,
  onShutdown,
};
