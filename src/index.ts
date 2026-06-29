import { BasicTool } from "zotero-plugin-toolkit/dist/basic";
import Addon from "./addon";
import { config } from "../package.json";
import { ItemBoxManager } from "zotero-plugin-toolkit/dist/managers/itemBox";

const basicTool = new BasicTool();
const ZoteroGlobal =
  typeof Zotero !== "undefined"
    ? Zotero
    : Components.classes["@zotero.org/Zotero;1"].getService(
        Components.interfaces.nsISupports
      ).wrappedJSObject;

function patchItemBoxCompatibility() {
  const proto = ItemBoxManager.prototype as any;
  if (proto.__zptSafeItemBoxPatched) {
    return;
  }
  const originalInitializeGlobal = proto.initializeGlobal;
  if (typeof originalInitializeGlobal === "function") {
    proto.initializeGlobal = async function (...args: any[]) {
      try {
        return await originalInitializeGlobal.apply(this, args);
      } catch (error) {
        const msg = String(error);
        const lower = msg.toLowerCase();
        const isCompatibleError =
          lower.includes("item-box") ||
          lower.includes("customelements") ||
          lower.includes("not a constructor") ||
          lower.includes("is not a constructor");
        if (!isCompatibleError) {
          throw error;
        }
        this.log?.(`ItemBoxManager compatibility patch: ${String(error)}`);
        this.globalCache = this.globalCache || {};
        if (typeof this.globalCache._ready === "boolean") {
          this.globalCache._ready = false;
        }
        this.initializationLock?.resolve?.();
      }
    };
  }
  proto.__zptSafeItemBoxPatched = true;
}

if (!ZoteroGlobal[config.addonInstance]) {
  function bindMainWindow(mainWindow?: Window) {
    const window = mainWindow || basicTool.getGlobal("window");
    const win = window as any;
    _globalThis.Zotero = ZoteroGlobal;
    _globalThis.ZoteroPane = win.ZoteroPane;
    _globalThis.Zotero_Tabs = win.Zotero_Tabs;
    _globalThis.window = window;
    _globalThis.console = win.console;
    _globalThis.URL = win.URL;
    _globalThis.setTimeout = window.setTimeout.bind(window);
    _globalThis.clearTimeout = window.clearTimeout.bind(window);
    _globalThis.setInterval = window.setInterval.bind(window);
    _globalThis.clearInterval = window.clearInterval.bind(window);
    _globalThis.URLSearchParams = win.URLSearchParams;
    _globalThis.Headers = win.Headers;
    _globalThis.AbortController = win.AbortController;
    _globalThis.AbortSignal = win.AbortSignal;
    _globalThis.Response = win.Response;
    _globalThis.Request = win.Request;
    _globalThis.fetch = win.fetch?.bind(window);
    _globalThis.structuredClone =
      win.structuredClone?.bind(window) ||
      ((value: unknown) => JSON.parse(JSON.stringify(value)));
    _globalThis.AbortSignal.timeout = (ms: number) => {
      const controller = new win.AbortController();
      const timer = window.setTimeout(() => controller.abort(), ms);
      controller.signal.addEventListener("abort", () => {
        window.clearTimeout(timer);
      });
      return controller.signal;
    };

    _globalThis.document = window.document;
  }

  _globalThis.__bindMainWindow = bindMainWindow;
  bindMainWindow();
  patchItemBoxCompatibility();
  _globalThis.addon = new Addon();
  ZoteroGlobal.Prefs.set(
    `${config.addonRef}.diagnosticStage`,
    `index-created:${Date.now()}`
  );
  _globalThis.ztoolkit = addon.data.ztoolkit;
  ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  ztoolkit.basicOptions.log.disableConsole = addon.data.env === "production";
  ztoolkit.UI.basicOptions.ui.enableElementJSONLog = false
  ztoolkit.UI.basicOptions.ui.enableElementDOMLog = false
  ztoolkit.basicOptions.debug.disableDebugBridgePassword =
    addon.data.env === "development";
  ZoteroGlobal[config.addonInstance] = addon;
}
