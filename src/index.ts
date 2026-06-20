import { BasicTool } from "zotero-plugin-toolkit/dist/basic";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();

if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
  function bindMainWindow(mainWindow?: Window) {
    const window = mainWindow || basicTool.getGlobal("window");
    const win = window as any;
    _globalThis.ZoteroPane = win.ZoteroPane;
    _globalThis.Zotero_Tabs = win.Zotero_Tabs;
    _globalThis.window = window;
    _globalThis.URL = win.URL;
    _globalThis.setTimeout = window.setTimeout;
    _globalThis.URLSearchParams = win.URLSearchParams;
    _globalThis.Headers = win.Headers;
    _globalThis.AbortSignal = win.AbortSignal;
    _globalThis.Request = win.Request;
    _globalThis.AbortSignal.timeout = (ms: number) => {
      // @ts-ignore
      const controller = new win.AbortController();
      const timer = window.setTimeout(() => controller.abort(), ms);
      controller.signal.addEventListener("abort", () => {
        window.clearTimeout(timer);
      });
      return controller.signal;
    }
    _globalThis.document = window.document;
  }

  _globalThis.Zotero = basicTool.getGlobal("Zotero");
  _globalThis.__bindMainWindow = bindMainWindow;
  _globalThis.addon = new Addon();
  _globalThis.ztoolkit = addon.data.ztoolkit;
  ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  ztoolkit.basicOptions.log.disableConsole = addon.data.env === "production";
  ztoolkit.UI.basicOptions.ui.enableElementJSONLog = false
  ztoolkit.UI.basicOptions.ui.enableElementDOMLog = false
  ztoolkit.basicOptions.debug.disableDebugBridgePassword =
    addon.data.env === "development";
  Zotero[config.addonInstance] = addon;
}
