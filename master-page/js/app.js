/**
 * Master Page — standalone multi-format document viewer
 * Independent static app. Not part of any other project or API.
 */
(function () {
  "use strict";

  const FILES = {
    A: {
      id: "A",
      title: "Section A — Word Document",
      titleAr: "القسم أ — مستند Word",
      path: "assets/section-a.docx",
      previewImage: "assets/section-a-preview.jpeg",
      format: "docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      role: "Uploaded Word document (image-based page inside DOCX).",
      roleAr: "ملف Word مرفوع — الصفحة عبارة عن صورة مضمّنة.",
      source: "section-a.docx",
      meta: {
        type: "Microsoft Word (.docx)",
        pages: "1 (image-based)",
        converter: "SolidFramework v10.0.19910.1",
        creatorDevice: "Canon MF1333C / C1333iF",
        producer: "Adobe PSL 1.4e for Canon",
        created: "2026-07-28",
        application: "Microsoft Office Word",
        note: "Contains one embedded JPEG; no extractable paragraph text.",
      },
    },
    B: {
      id: "B",
      title: "Section B — PDF Document",
      titleAr: "القسم ب — مستند PDF",
      path: "assets/section-b.pdf",
      format: "pdf",
      mime: "application/pdf",
      role: "Uploaded PDF document for on-page preview and download.",
      roleAr: "ملف PDF مرفوع للمعاينة والتحميل داخل الصفحة.",
      source: "section-b.pdf",
      meta: {
        type: "PDF 1.6",
        pages: "1",
        encoding: "Image-based page",
        note: "Rendered with the browser’s built-in PDF viewer.",
      },
    },
    C: {
      id: "C",
      title: "Section C — Image",
      titleAr: "القسم ج — صورة",
      path: "assets/section-c.png",
      format: "png",
      mime: "image/png",
      role: "Uploaded PNG image plus a structured field layout extracted from it.",
      roleAr: "صورة PNG مرفوعة مع هيكل الحقول المستخرج منها.",
      source: "section-c.png",
      meta: {
        type: "PNG image",
        note: "High-resolution scan/export of the same form document.",
      },
    },
  };

  /** Structured content preserved from File 3 (document fields only) */
  const FORM_STRUCTURE = {
    title: "قائمة فحص السيارات وقت التسليم",
    titleEn: "Vehicle Delivery Inspection Checklist",
    brands: ["Toyota", "عبداللطيف جميل / Abdul Latif Jameel Motors"],
    branchDefaults: [
      { label: "إسم الفرع", value: "Telesales North" },
      { label: "المدينة - العنوان", value: "Telesales North / Jeddah 21599" },
      { label: "السجل التجاري الفرع", value: "4030287587" },
      { label: "هاتف", value: "012-6930000" },
      { label: "رمز", value: "7022" },
    ],
    customerFields: [
      "إسم المالك",
      "إسم المستخدم",
      "هاتف",
      "بريد إلكتروني",
      "رقم الهوية",
    ],
    printFields: ["تاريخ طباعة المستند", "وقت طباعة المستند"],
    chassisLabel: "رقم الشاسيه / الهيكل",
    qualityNote:
      "أقر بأن فنيي الصيانة المعتمدين قاموا بفحص جودة المركبة قبل التسليم وأن جميع الأنظمة تعمل بشكل صحيح.",
    vehicleChecksRight: [
      "نظافة وخلو الهيكل الخارجي من الأضرار*",
      "نظافة وخلو المقصورة الداخلية من الأضرار*",
      "التسليم بجميع المواصفات المتفق عليها",
      "وجود الإطار الاحتياطي والمفتاح والرافعة",
      "وجود طقم الأدوات",
      "وجود طفاية الحريق",
      "وجود حقيبة الإسعافات الأولية",
      "شرح المواصفات وطريقة التشغيل (عند الطلب)",
      "وجود كتيب المالك",
      "وجود كتيب الضمان",
      "التعريف بجدول الصيانة",
    ],
    vehicleChecksLeft: [
      "فرش الأرضية",
      "بطاقة الذاكرة (إن وجدت)",
      "أخرى",
      "أخرى",
      "أخرى",
    ],
    extraEquipmentNote: "التجهيزات الإضافية — بنود قابلة للتعبئة يدوياً",
    serviceNote:
      "سيتواصل قسم المبيعات وخدمة العملاء للمتابعة. لحجز موعد الصيانة المجانية عند 1000 كم اتصل بالرقم المجاني 8004400055.",
    acknowledgement:
      "أقر أنا الموقع أدناه باستلام المركبة بحالة جيدة واستلام جميع المستندات اللازمة والموافقة على شروط ضمان الشركة المصنعة.",
    signatures: ["اسم الضيف / التوقيع", "مسؤول التسليم / التوقيع"],
    companyFooter:
      "عبداللطيف جميل للتجارة بالتجزئة المحدودة — المركز الرئيسي: جدة — شارع الأمير ماجد ص.ب 248 جدة 21411",
  };

  const state = {
    active: "A",
    loaded: { A: false, B: false, C: false },
    errors: {},
    fileInfo: {},
  };

  const els = {};

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function detectFormat(path, mimeHint) {
    const lower = (path || "").toLowerCase();
    if (lower.endsWith(".docx") || (mimeHint || "").includes("wordprocessingml")) return "docx";
    if (lower.endsWith(".pdf") || (mimeHint || "").includes("pdf")) return "pdf";
    if (/\.(png|jpe?g|gif|webp)$/i.test(lower) || (mimeHint || "").startsWith("image/")) return "image";
    return "unknown";
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function showToast(message) {
    const toast = els.toast;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("is-show"), 2800);
  }

  function setActiveSection(id) {
    state.active = id;
    const file = FILES[id];

    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.section === id);
    });
    document.querySelectorAll(".stat-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.section === id);
    });
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.classList.toggle("is-visible", panel.id === `panel-${id}`);
    });

    els.topTitle.textContent = file.titleAr;
    els.topSub.textContent = `${file.title} · ${file.source}`;
    els.downloadBtn.href = file.path;
    els.downloadBtn.download = file.source.split("/").pop();
    els.downloadBtn.setAttribute("aria-label", `Download ${file.source}`);

    document.body.classList.remove("nav-open");
    ensureSectionLoaded(id);
  }

  async function probeFile(file) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(file.path, {
        method: "HEAD",
        cache: "no-cache",
        signal: controller.signal,
      });
      if (!res.ok) {
        const getRes = await fetch(file.path, { method: "GET", cache: "no-cache", signal: controller.signal });
        if (!getRes.ok) throw new Error(`HTTP ${getRes.status}`);
        const blob = await getRes.blob();
        return {
          ok: true,
          size: blob.size,
          mime: blob.type || file.mime,
          format: detectFormat(file.path, blob.type || file.mime),
        };
      }
      const size = Number(res.headers.get("content-length"));
      const mime = res.headers.get("content-type") || file.mime;
      return {
        ok: true,
        size: Number.isFinite(size) ? size : null,
        mime,
        format: detectFormat(file.path, mime),
      };
    } catch (err) {
      return { ok: false, error: err.name === "AbortError" ? "Request timed out" : err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  function renderMetaList(target, file, info) {
    const rows = [
      ["Source", file.source],
      ["Format", (info && info.format ? info.format : file.format).toUpperCase()],
      ["MIME", (info && info.mime) || file.mime],
      ["Size", info && info.size != null ? formatBytes(info.size) : "—"],
      ...Object.entries(file.meta).map(([k, v]) => [k, v]),
    ];
    target.innerHTML = rows
      .map(
        ([k, v]) =>
          `<li><span class="k">${escapeHtml(String(k))}</span><span class="v">${escapeHtml(String(v))}</span></li>`
      )
      .join("");
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderLoading(el, label) {
    el.innerHTML = `<div class="loading"><div class="spinner" aria-hidden="true"></div><p>${escapeHtml(label)}</p></div>`;
  }

  function renderError(el, message) {
    el.innerHTML = `<div class="error error-box"><strong>تعذر التحميل</strong><p>${escapeHtml(message)}</p><p>Place the file under <code>master-page/assets/</code> and open this folder via any static HTTP server.</p></div>`;
  }

  function renderDocxPreview(container, file) {
    container.innerHTML = `
      <img src="${escapeHtml(file.previewImage)}" alt="Embedded preview from ${escapeHtml(file.source)}"
        loading="lazy" />
    `;
    const img = container.querySelector("img");
    img.addEventListener("error", () => {
      renderError(container, `Could not load embedded DOCX preview (${file.previewImage}).`);
    });
  }

  function renderPdfPreview(container, file) {
    container.innerHTML = `
      <object data="${escapeHtml(file.path)}#toolbar=1&navpanes=0" type="application/pdf" aria-label="PDF preview">
        <iframe src="${escapeHtml(file.path)}" title="PDF preview of ${escapeHtml(file.source)}"></iframe>
        <div class="empty">
          <p>تعذر عرض PDF داخل المتصفح.</p>
          <a class="btn btn-primary" href="${escapeHtml(file.path)}" download>تحميل الملف</a>
        </div>
      </object>
    `;
  }

  function renderImagePreview(container, file) {
    container.innerHTML = `
      <img src="${escapeHtml(file.path)}" alt="${escapeHtml(FORM_STRUCTURE.title)}" loading="lazy" />
    `;
    const img = container.querySelector("img");
    img.addEventListener("error", () => {
      renderError(container, `Could not load image (${file.path}).`);
    });
  }

  function renderStructuredForm(target) {
    const f = FORM_STRUCTURE;
    const branch = f.branchDefaults
      .map((r) => `<div class="info-row"><span class="label">${escapeHtml(r.label)}</span><span class="value">${escapeHtml(r.value)}</span></div>`)
      .join("");
    const customer = f.customerFields
      .map((label) => `<div class="info-row"><span class="label">${escapeHtml(label)}</span><span class="value"></span></div>`)
      .join("");
    const checksR = f.vehicleChecksRight
      .map((t) => `<div class="check-item"><span class="check-box" aria-hidden="true"></span><span>${escapeHtml(t)}</span></div>`)
      .join("");
    const checksL = f.vehicleChecksLeft
      .map((t) => `<div class="check-item"><span class="check-box" aria-hidden="true"></span><span>${escapeHtml(t)}</span></div>`)
      .join("");

    target.innerHTML = `
      <article class="form-doc" aria-label="${escapeHtml(f.title)}">
        <header class="form-doc-header">
          <div class="logo-slot right">${escapeHtml(f.brands[1])}</div>
          <h5>${escapeHtml(f.title)}</h5>
          <div class="logo-slot left">${escapeHtml(f.brands[0])}</div>
        </header>
        <p class="note-block" style="text-align:center;margin-top:-6px;opacity:.75">${escapeHtml(f.titleEn)}</p>
        <div class="info-box">
          <div class="info-col">${customer}</div>
          <div class="info-col">${branch}</div>
        </div>
        <div class="info-box" style="grid-template-columns:1fr 1fr">
          ${f.printFields
            .map((label) => `<div class="info-col"><div class="info-row"><span class="label">${escapeHtml(label)}</span><span class="value"></span></div></div>`)
            .join("")}
        </div>
        <div class="vin-line">${escapeHtml(f.chassisLabel)} : _______________________________</div>

        <div class="section-title">فحص الجودة</div>
        <p class="note-block">${escapeHtml(f.qualityNote)}</p>

        <div class="section-title">فحص المركبة</div>
        <div class="check-grid">${checksR}${checksL}</div>

        <div class="section-title">التجهيزات الإضافية</div>
        <p class="note-block">${escapeHtml(f.extraEquipmentNote)}</p>
        <div class="check-grid">
          ${[1, 2, 3, 4]
            .map(() => `<div class="check-item"><span class="check-box"></span><span>________________</span></div>`)
            .join("")}
        </div>

        <p class="note-block">${escapeHtml(f.serviceNote)}</p>

        <div class="ack-box">
          <div class="section-title">إقرار الضيف</div>
          <p class="note-block">${escapeHtml(f.acknowledgement)}</p>
          <div class="sig-row">
            ${f.signatures
              .map((s) => `<div><div>${escapeHtml(s)}</div><div class="sig-line"></div></div>`)
              .join("")}
          </div>
        </div>
        <footer class="form-footer">${escapeHtml(f.companyFooter)}</footer>
      </article>
    `;
  }

  async function ensureSectionLoaded(id) {
    if (state.loaded[id]) return;
    const file = FILES[id];
    const preview = $(`#preview-${id}`);
    const meta = $(`#meta-${id}`);
    if (!preview || !meta) return;

    renderLoading(preview, `جاري تحميل ${file.source}…`);
    const info = await probeFile(file);
    state.fileInfo[id] = info;

    if (!info.ok) {
      state.errors[id] = info.error;
      renderError(preview, info.error || "Unknown error");
      renderMetaList(meta, file, info);
      updateStatChips(id, false);
      return;
    }

    const format = info.format || detectFormat(file.path, file.mime);
    if (format === "docx") renderDocxPreview(preview, file);
    else if (format === "pdf") renderPdfPreview(preview, file);
    else if (format === "image") renderImagePreview(preview, file);
    else renderError(preview, `Unsupported format: ${format}`);

    renderMetaList(meta, file, info);
    updateStatChips(id, true, info);
    state.loaded[id] = true;
  }

  function updateStatChips(id, ok, info) {
    const card = $(`.stat-card[data-section="${id}"]`);
    if (!card) return;
    const chips = card.querySelector(".chip-row");
    if (!chips) return;
    const size = info && info.size != null ? formatBytes(info.size) : "—";
    chips.innerHTML = ok
      ? `<span class="chip chip--ok">Loaded</span><span class="chip chip--info">${escapeHtml((info.format || FILES[id].format).toUpperCase())}</span><span class="chip">${escapeHtml(size)}</span>`
      : `<span class="chip chip--warn">Missing</span>`;
  }

  function bindEvents() {
    document.querySelectorAll("[data-section]").forEach((el) => {
      el.addEventListener("click", () => setActiveSection(el.dataset.section));
    });

    els.menuToggle.addEventListener("click", () => {
      document.body.classList.toggle("nav-open");
    });

    els.overlay.addEventListener("click", () => {
      document.body.classList.remove("nav-open");
    });

    els.reloadBtn.addEventListener("click", async () => {
      const id = state.active;
      state.loaded[id] = false;
      showToast(`إعادة تحميل القسم ${id}…`);
      await ensureSectionLoaded(id);
      showToast("تم التحديث");
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "1") setActiveSection("A");
      if (e.key === "2") setActiveSection("B");
      if (e.key === "3") setActiveSection("C");
      if (e.key === "Escape") document.body.classList.remove("nav-open");
    });
  }

  function cacheElements() {
    els.topTitle = $("#top-title");
    els.topSub = $("#top-sub");
    els.downloadBtn = $("#download-btn");
    els.reloadBtn = $("#reload-btn");
    els.menuToggle = $("#menu-toggle");
    els.overlay = $("#nav-overlay");
    els.toast = $("#toast");
  }

  async function init() {
    cacheElements();
    bindEvents();
    renderStructuredForm($("#structured-form"));
    setActiveSection("A");
    ensureSectionLoaded("B");
    ensureSectionLoaded("C");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
