/* global Zotero */
(() => {
  const observerID = "author-affiliation-autofetch";
  let notifierID = null;
  const log = (...args) => Zotero.debug("[Author Affiliation AutoFetch] " + args.join(" "));

  function normalizeDOI(value) {
    let doi = String(value || "").trim();
    const lower = doi.toLowerCase();
    for (const prefix of ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/"]) {
      if (lower.startsWith(prefix)) {
        doi = doi.slice(prefix.length);
        break;
      }
    }
    if (doi.toLowerCase().startsWith("doi:")) doi = doi.slice(4).trim();
    return doi.replace(/[)\].,;]+$/, "").trim();
  }

  function normalizeAuthorName(value) {
    return String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function getAuthorName(entry) {
    return entry.raw_author_name ||
      (entry.author && entry.author.display_name) ||
      entry.name ||
      [entry.given, entry.family].filter(Boolean).join(" ") ||
      "Unknown author";
  }

  function getAuthorORCID(entry) {
    return entry.raw_orcid ||
      (entry.author && entry.author.orcid) ||
      entry.ORCID ||
      "";
  }

  function getRawAffiliations(entry) {
    if (Array.isArray(entry.raw_affiliation_strings) && entry.raw_affiliation_strings.length) {
      return entry.raw_affiliation_strings.filter(Boolean);
    }
    if (Array.isArray(entry.affiliations) && entry.affiliations.length) {
      return entry.affiliations.map(x => x && (x.raw_affiliation_string || x.name)).filter(Boolean);
    }
    return [];
  }

  function getInstitutions(entry) {
    const institutions = Array.isArray(entry.institutions) ? entry.institutions : [];
    const fromInstitutions = institutions.map(inst => ({
      id: inst && inst.id ? inst.id : "",
      name: inst && inst.display_name ? inst.display_name : "",
      country: inst && inst.country_code ? inst.country_code : ""
    })).filter(inst => inst.name || inst.id);

    const fromAffiliations = (Array.isArray(entry.affiliations) ? entry.affiliations : [])
      .flatMap(aff => (aff && Array.isArray(aff.institution_ids) ? aff.institution_ids : []).map(id => ({
        id,
        name: "",
        country: ""
      })));

    const seen = new Set();
    return [...fromInstitutions, ...fromAffiliations].filter(inst => {
      const key = inst.id || inst.name;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeAuthorships(record) {
    const entries = Array.isArray(record && record.authorships) ? record.authorships : [];
    return entries.map((entry, index) => {
      const institutions = getInstitutions(entry);
      const rawAffiliations = getRawAffiliations(entry);
      const author = entry.author || {};
      return {
        order: index + 1,
        positionLabel: entry.author_position || "",
        name: getAuthorName(entry),
        displayName: author.display_name || "",
        orcid: getAuthorORCID(entry),
        rawAffiliations,
        institutions,
        countries: Array.isArray(entry.countries) ? entry.countries : [],
        corresponding: entry.is_corresponding === true
      };
    });
  }

  async function handleNewItem(itemID, options = {}) {
    const item = Zotero.Items.get(itemID);
    if (!item || !item.isRegularItem()) return;

    const doi = normalizeDOI(item.getField("DOI"));
    if (!doi) return;

    if (!options.force) {
      for (const noteID of item.getNotes()) {
        const note = Zotero.Items.get(noteID);
        if (note && note.getNote().includes("Author Affiliation AutoFetch")) return;
      }
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
        if (!record && crossref && crossref.authorships.length) {
          record = crossref;
          source = "Crossref";
        } else if (record && crossref && mergeCrossrefAffiliations(record, crossref)) {
          source = "OpenAlex + Crossref supplement";
        }
      } catch (error) {
        log("Crossref lookup/supplement failed", error && error.message ? error.message : error);
      }

      if (!record) {
        log("No author-affiliation metadata found for item", itemID);
        return;
      }

      const recordDOI = normalizeDOI(record.doi || record.DOI || "");
      if (recordDOI && recordDOI.toLowerCase() !== doi.toLowerCase()) {
        throw new Error("Returned DOI does not match Zotero item DOI");
      }

      await saveAffiliationNote(item, record, source, doi);
      log("Saved", source, "affiliations for item", itemID);
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
      authorships: message.author.map(author => ({
        raw_author_name: [author.given, author.family].filter(Boolean).join(" ") || author.name || "Unknown author",
        raw_affiliation_strings: (author.affiliation || []).map(x => x.name).filter(Boolean),
        institutions: [],
        is_corresponding: false
      }))
    };
  }

  // Crossref is used only when an exact normalized author-name match is found.
  // It never overwrites an OpenAlex affiliation already present for that author.
  function mergeCrossrefAffiliations(openalexRecord, crossrefRecord) {
    if (!openalexRecord || !crossrefRecord) return false;
    let merged = false;
    const crossrefAuthors = crossrefRecord.authorships || [];
    for (const openalexAuthor of (openalexRecord.authorships || [])) {
      if (getRawAffiliations(openalexAuthor).length) continue;
      const key = normalizeAuthorName(getAuthorName(openalexAuthor));
      if (!key) continue;
      const matches = crossrefAuthors.filter(author => normalizeAuthorName(getAuthorName(author)) === key);
      if (matches.length !== 1) continue;
      const supplementary = getRawAffiliations(matches[0]);
      if (supplementary.length) {
        openalexAuthor.raw_affiliation_strings = supplementary.slice();
        merged = true;
      }
    }
    return merged;
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderNote(record, source, fallbackDOI) {
    const authors = normalizeAuthorships(record);
    const rows = authors.map(author => {
      const institutionNames = author.institutions.map(x => x.name).filter(Boolean);
      const rawHTML = author.rawAffiliations.length
        ? author.rawAffiliations.map(value => "<li>" + escapeHTML(value) + "</li>").join("")
        : "<li>数据库未提供原始单位文本</li>";
      const institutionHTML = institutionNames.length
        ? institutionNames.map(value => "<li>" + escapeHTML(value) + "</li>").join("")
        : "<li>未识别机构名称</li>";
      const institutionIDs = author.institutions.map(x => x.id).filter(Boolean);
      const orcidHTML = author.orcid
        ? '<a href="' + escapeHTML(author.orcid) + '">' + escapeHTML(author.orcid) + "</a>"
        : "未提供";
      const countries = author.countries.length ? author.countries.join(", ") : "未提供";
      const corresponding = author.corresponding ? "是" : "否";

      return "<tr>" +
        "<td>" + author.order + "</td>" +
        "<td>" + escapeHTML(author.name) +
          (author.displayName && author.displayName !== author.name
            ? "<br><small>数据库显示名：" + escapeHTML(author.displayName) + "</small>" : "") +
          (author.positionLabel ? "<br><small>位置标记：" + escapeHTML(author.positionLabel) + "</small>" : "") +
        "</td>" +
        "<td>" + orcidHTML + "</td>" +
        "<td><ul>" + rawHTML + "</ul></td>" +
        "<td><ul>" + institutionHTML + "</ul>" +
          (institutionIDs.length ? "<small>机构 ID：" + institutionIDs.map(escapeHTML).join("<br>") + "</small>" : "") +
        "</td>" +
        "<td>" + escapeHTML(countries) + "</td>" +
        "<td>" + corresponding + "</td>" +
      "</tr>";
    }).join("");

    const fetchedAt = new Date().toISOString();
    const title = Array.isArray(record.title) ? record.title[0] : (record.title || "");
    const doi = record.doi || record.DOI || fallbackDOI || "";
    return "<p><b>数据来源：</b>" + escapeHTML(source) + "</p>" +
      "<p><b>DOI：</b>" + escapeHTML(doi) + "</p>" +
      "<p><b>抓取时间（UTC）：</b>" + escapeHTML(fetchedAt) + "</p>" +
      (title ? "<p><b>论文标题：</b>" + escapeHTML(title) + "</p>" : "") +
      "<table><thead><tr><th>序号</th><th>作者</th><th>ORCID</th><th>原始单位文本</th><th>识别机构</th><th>国家/地区</th><th>通讯作者</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>" +
      "<p><i>整理规则：作者序号按 authorships 数组顺序生成；保留原始署名和单位文本；机构 ID 用于识别同一机构；仅在作者姓名规范化后唯一精确匹配时才使用 Crossref 补充，不根据姓名猜测单位。</i></p>";
  }

  async function saveAffiliationNote(parentItem, record, source, doi) {
    const marker = "Author Affiliation AutoFetch";
    const noteContent = "<h2>" + marker + "</h2>" + renderNote(record, source, doi);
    for (const noteID of parentItem.getNotes()) {
      const note = Zotero.Items.get(noteID);
      if (note && note.getNote().includes(marker)) {
        note.setNote(noteContent);
        await note.saveTx();
        return;
      }
    }

    const note = new Zotero.Item("note");
    note.libraryID = parentItem.libraryID;
    note.setNote(noteContent);
    note.parentID = parentItem.id;
    await note.saveTx();
  }

  const observer = {
    notify(event, type, ids) {
      if ((event !== "add" && event !== "modify") || type !== "item") return;
      for (const id of ids) {
        Zotero.Promise.delay(0)
          .then(() => handleNewItem(id))
          .catch(error => log("Notifier task failed", error));
      }
    }
  };

  notifierID = Zotero.Notifier.registerObserver(observer, ["item"], observerID);
  log("Plugin started; watching newly added items.");

  addon.shutdown = () => {
    if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = null;
    log("Plugin stopped.");
  };
})();
