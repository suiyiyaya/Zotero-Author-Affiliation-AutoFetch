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

    // Avoid repeated lookups when Zotero modifies an item after its metadata import.
    const existingNotes = item.getNotes();
    for (const noteID of existingNotes) {
      const note = Zotero.Items.get(noteID);
      if (note && note.getNote().includes("Author Affiliation AutoFetch")) return;
    }

    try {
      let record = null;
      let source = "";
      try {
        const openalex = await fetchOpenAlexByDOI(doi);
        if (openalex && Array.isArray(openalex.authorships) && openalex.authorships.length) {
          record = openalex;
          source = "OpenAlex";
        }
      } catch (error) {
        log("OpenAlex lookup failed; trying Crossref", error && error.message ? error.message : error);
      }

      try {
        const crossref = await fetchCrossrefByDOI(doi);
        if (!record && crossref && Array.isArray(crossref.authorships) && crossref.authorships.length) {
          record = crossref;
          source = "Crossref";
        } else if (record && source === "OpenAlex" && mergeCrossrefAffiliations(record, crossref)) {
          source = "OpenAlex + Crossref supplement";
        }
      } catch (error) {
        log("Crossref lookup/supplement failed", error && error.message ? error.message : error);
      }

      if (record) {
        await saveAffiliationNote(item, record, source);
        log("Saved", source, "affiliations for item", itemID);
      } else {
        log("No author-affiliation metadata found for item", itemID);
      }
    } catch (error) {
      log("Processing failed for item", itemID, error && error.message ? error.message : error);
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

  function normalizeAuthorName(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function mergeCrossrefAffiliations(openalexRecord, crossrefRecord) {
    if (!openalexRecord || !crossrefRecord) return false;
    let merged = false;
    for (const openalexAuthor of (openalexRecord.authorships || [])) {
      const openalexName = normalizeAuthorName(
        openalexAuthor.raw_author_name ||
        (openalexAuthor.author && openalexAuthor.author.display_name)
      );
      if (!openalexName) continue;
      const match = (crossrefRecord.authorships || []).find(author =>
        normalizeAuthorName(author.raw_author_name) === openalexName
      );
      if (!match) continue;
      const current = openalexAuthor.raw_affiliation_strings || [];
      const supplementary = match.raw_affiliation_strings || [];
      if (!current.length && supplementary.length) {
        openalexAuthor.raw_affiliation_strings = supplementary.slice();
        merged = true;
      }
    }
    return merged;
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
      if ((event !== "add" && event !== "modify") || type !== "item") return;
      for (const id of ids) {
        // Defer network work until Zotero has completed the notifier transaction.
        Zotero.Promise.delay(0).then(() => handleNewItem(id)).catch(error => log("Notifier task failed", error));
      }
    }
  };

  notifierID = Zotero.Notifier.registerObserver(observer, ["item"], observerID);
  log("Plugin started; watching newly added items.");

  // Expose cleanup to the bootstrap scope.
  addon.shutdown = () => {
      if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
      notifierID = null;
      log("Plugin stopped.");
  };
})();
