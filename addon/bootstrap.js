/**
 * Most of this code is from Zotero team's official Make It Red example[1]
 * or the Zotero 7 documentation[2].
 * [1] https://github.com/zotero/make-it-red
 * [2] https://www.zotero.org/support/dev/zotero_7_for_developers
 */

if (typeof Zotero == "undefined") {
  var Zotero;
}

var chromeHandle;

function getServices() {
  if (typeof Services !== "undefined") {
    return Services;
  }
  if (typeof ChromeUtils !== "undefined" && ChromeUtils.importESModule) {
    return ChromeUtils.importESModule(
      "resource://gre/modules/Services.sys.mjs"
    ).Services;
  }
  return ChromeUtils.import("resource://gre/modules/Services.jsm").Services;
}

function normalizeRootURI(rootURI, resourceURI) {
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }
  return rootURI.endsWith("/") ? rootURI : `${rootURI}/`;
}

function reportBootstrapError(error) {
  try {
    if (typeof Zotero !== "undefined" && Zotero.logError) {
      Zotero.logError(error);
    }
  } catch (_) {}
  throw error;
}

function markStage(stage) {
  try {
    if (typeof Zotero !== "undefined" && Zotero.Prefs) {
      Zotero.Prefs.set("__addonRef__.diagnosticStage", `${stage}:${Date.now()}`);
    }
  } catch (_) {}
}

// In Zotero 6, bootstrap methods are called before Zotero is initialized, and using include.js
// to get the Zotero XPCOM service would risk breaking Zotero startup. Instead, wait for the main
// Zotero window to open and get the Zotero object from there.
//
// In Zotero 7, bootstrap methods are not called until Zotero is initialized, and the 'Zotero' is
// automatically made available.
async function waitForZotero() {
  if (typeof Zotero != "undefined") {
    await Zotero.initializationPromise;
  }

  var services = getServices();
  var windows = services.wm.getEnumerator("navigator:browser");
  var found = false;
  while (windows.hasMoreElements()) {
    let win = windows.getNext();
    if (win.Zotero) {
      Zotero = win.Zotero;
      found = true;
      break;
    }
  }
  if (!found) {
    await new Promise((resolve) => {
      var listener = {
        onOpenWindow: function (aWindow) {
          // Wait for the window to finish loading
          let domWindow = aWindow
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
          domWindow.addEventListener(
            "load",
            function () {
              domWindow.removeEventListener("load", arguments.callee, false);
              if (domWindow.Zotero) {
                services.wm.removeListener(listener);
                Zotero = domWindow.Zotero;
                resolve();
              }
            },
            false
          );
        },
      };
      services.wm.addListener(listener);
    });
  }
  await Zotero.initializationPromise;
}

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await waitForZotero();

  rootURI = normalizeRootURI(rootURI, resourceURI);
  var services = getServices();
  markStage("bootstrap-startup");
  Zotero.debug(`[${id}] bootstrap startup from ${rootURI}`);

  if (Zotero.platformMajorVersion >= 102) {
    var aomStartup = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    var manifestURI = services.io.newURI(rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "__addonRef__", rootURI + "chrome/content/"],
      ["locale", "__addonRef__", "en-US", rootURI + "chrome/locale/en-US/"],
      ["locale", "__addonRef__", "zh-CN", rootURI + "chrome/locale/zh-CN/"],
    ]);
  } else {
    setDefaultPrefs(rootURI);
  }

  /**
   * Global variables for plugin code.
   * The `_globalThis` is the global root variable of the plugin sandbox environment
   * and all child variables assigned to it is globally accessible.
   * See `src/index.ts` for details.
   */
  const ctx = {
    rootURI,
  };
  ctx._globalThis = ctx;

  const scriptURI = `${rootURI}chrome/content/scripts/index.js`;
  try {
    services.scriptloader.loadSubScript(scriptURI, ctx);
    Zotero.debug(`[${id}] loaded ${scriptURI}`);
    markStage("bootstrap-script-loaded");
    await Zotero.__addonInstance__?.hooks?.onStartup();
    markStage("bootstrap-startup-complete");
  } catch (error) {
    reportBootstrapError(error);
  }
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks?.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks?.onMainWindowUnload(window);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports
    ).wrappedJSObject;
  }
  rootURI = normalizeRootURI(rootURI, resourceURI);
  if (Zotero.__addonInstance__?.hooks?.onShutdown) {
    Zotero.__addonInstance__.hooks.onShutdown();
  }

  Cc["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .flushBundles();

  if (typeof Cu !== "undefined" && typeof Cu.unload === "function") {
    Cu.unload(`${rootURI}chrome/content/scripts/index.js`);
  }

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}

// Loads default preferences from defaults/preferences/prefs.js in Zotero 6
function setDefaultPrefs(rootURI) {
  var services = getServices();
  var branch = services.prefs.getDefaultBranch("");
  var obj = {
    pref(pref, value) {
      switch (typeof value) {
        case "boolean":
          branch.setBoolPref(pref, value);
          break;
        case "string":
          branch.setStringPref(pref, value);
          break;
        case "number":
          branch.setIntPref(pref, value);
          break;
        default:
          Zotero.logError(`Invalid type '${typeof value}' for pref '${pref}'`);
      }
    },
  };
  Zotero.getMainWindow().console.log(rootURI + "prefs.js");
  services.scriptloader.loadSubScript(rootURI + "prefs.js", obj);
}
