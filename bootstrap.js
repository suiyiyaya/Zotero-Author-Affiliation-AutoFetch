/* global Zotero */

var _addon = {};

function install(data, reason) {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "src/main.js", {
    Zotero,
    Services,
    addonID: id,
    addonVersion: version,
    rootURI
  });
}

function shutdown({ id, version, rootURI }, reason) {
  if (_addon.shutdown) {
    _addon.shutdown();
  }
}

function uninstall(data, reason) {}
