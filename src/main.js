/* global Zotero */
(() => {
  const observerID = "author-affiliation-autofetch";
  let notifierID = null;

  const log = (...args) => Zotero.debug("[Author Affiliation AutoFetch] " + args.join(" "));

  async function handleNewItem(itemID) {
    const item = Zotero.Items.get(itemID);
    if (!item || !item.isRegularItem()) return;

    const doi = (item.getField("DOI") || "").trim();
    if (!doi) return;

    try {
      const record = await fetchOpenAlexByDOI(doi);
      if (record && Array.isArray(record.authorships) && record.authorships.length) {
        await saveAffiliationNote(item, record, "OpenAlex");
        log("Saved OpenAlex affiliations for item", itemID);
        return;
      }

      const crossref = await fetchCrossrefByDOI(doi);
      if (crossref) {
        await saveAffiliationNote(item, crossref, "Crossref");
        log("Saved Crossref affiliations for item", itemID);
      }
    } catch (error) {
      log("Fetch failed for item", itemID, error && error.message ? error.message : error);
    }
  }

  async function fetchOpenAlexByDOI(doi) {
    const url = "https://api.openalex.org/works/https://doi.org/" + encodeURIComponent(doi);
    const response = await Zotero.HTTP.request("GET", url, {
      headers: { "Accept": "application/json" }
    });
    if (response.status !== 200) throw new Error("OpenAlex HTTP " + response.status);
    return JSON.parse(response.responseText);
  }

  async function fetchCrossrefByDOI(doi) {
    const url = "https://api.crossref.org/works/" + encodeURIComponent(doi);
    const response = await Zotero.HTTP.request("GET", url, {
      headers: { "Accept": "application/json" }
    });
    if (response.status !== 200) return null;

    const message = JSON.parse(response.responseText).message;
    if (!message || !Array.isArray(message.author)) return null;

    return {
      title: Array.isArray(message.title) ? message.title[0] : "",
      doi: message.DOI || doi,
      authorships: message.author.map((author, index) => ({
        author_position: index + 1,
        raw_author_name: [author.given, author.family].filter(Boolean).join(" ") || author.name || "Unknown author",
        raw_affiliation_strings: (author.affiliation || []).map(x => x.name).filter(Boolean),
        institutions: [],
        is_corresponding: false
      }))
    };
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderNote(record, source) {
    const rows = (record.authorships || []).map((entry, index) => {
      const name = entry.raw_author_name || (entry.author && entry.author.display_name) || "Unknown author";
      const rawAffiliations = entry.raw_affiliation_strings || [];
      const institutions = (entry.institutions || []).map(inst => inst.display_name).filter(Boolean);
      const affiliations = rawAffiliations.length ? rawAffiliations : institutions;
      const position = entry.author_position || (index + 1);
      const corresponding = entry.is_corresponding ? "（通讯作者）" : "";
      const affiliationHTML = affiliations.length
        ? affiliations.map(x => "<li>" + escapeHTML(x) + "</li>").join("")
        : "<li>数据库未提供可确认的单位信息</li>";

      return "<tr><td>" + position + "</td><td>" + escapeHTML(name) + corresponding +
        "</td><td><ul>" + affiliationHTML + "</ul></td></tr>";
    }).join("");

    const fetchedAt = new Date().toISOString();
    const title = Array.isArray(record.title) ? record.title[0] : (record.title || "");
    return "<h2>作者及单位信息</h2>" +
      "<p><b>数据来源：</b>" + escapeHTML(source) + "</p>" +
      "<p><b>DOI：</b>" + escapeHTML(record.doi || "") + "</p>" +
      "<p><b>抓取时间（UTC）：</b>" + fetchedAt + "</p>" +
      (title ? "<p><b>论文标题：</b>" + escapeHTML(title) + "</p>" : "") +
      "<table><thead><tr><th>作者顺序</th><th>作者</th><th>作者单位</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>" +
      "<p><i>说明：单位信息按数据源提供的作者署名关联整理；数据库未提供时不进行姓名猜测。</i></p>";
  }

  async function saveAffiliationNote(parentItem, record, source) {
    const marker = "Author Affiliation AutoFetch";
    const existingNoteIDs = parentItem.getNotes();
    for (const noteID of existingNoteIDs) {
      const note = Zotero.Items.get(noteID);
      if (note && note.getNote().includes(marker)) {
        note.setNote("<h2>" + marker + "</h2>" + renderNote(record, source));
        await note.saveTx();
        return;
      }
    }

    const note = new Zotero.Item("note");
    note.libraryID = parentItem.libraryID;
    note.setNote("<h2>" + marker + "</h2>" + renderNote(record, source));
    note.parentID = parentItem.id;
    await note.saveTx();
  }

  const observer = {
    notify(event, type, ids) {
      if (event !== "add" || type !== "item") return;
      for (const id of ids) {
        // Defer network work until Zotero has completed the notifier transaction.
        Zotero.Promise.delay(0).then(() => handleNewItem(id));
      }
    }
  };

  notifierID = Zotero.Notifier.registerObserver(observer, ["item"], observerID);
  log("Plugin started; watching newly added items.");

  // Expose cleanup to the bootstrap scope.
  if (typeof _addon !== "undefined") {
    _addon.shutdown = () => {
      if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
      notifierID = null;
      log("Plugin stopped.");
    };
  }
})();
