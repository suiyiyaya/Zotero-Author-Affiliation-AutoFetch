/* global Zotero, Services */

var _addon = { shutdown: null };

function install(data, reason) {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "src/main.js", {
    Zotero,
    Services,
    addon: _addon,
    addonID: id,
    addonVersion: version,
    rootURI
  });
}

function shutdown(data, reason) {
  if (_addon.shutdown) {
    _addon.shutdown();
    _addon.shutdown = null;
  }
}

function uninstall(data, reason) {}
