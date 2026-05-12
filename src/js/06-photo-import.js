// ═══════════════════════════════════════════
// IMPORT — PHOTO (AI)
// ═══════════════════════════════════════════
async function handlePhotoImport(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const box = document.getElementById('aiBox');
  const msg = document.getElementById('aiMsg');
  box.classList.add('show');
  msg.textContent = 'READING LOGBOOK IMAGE...';

  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  try {
    msg.textContent = 'AI EXTRACTING FLIGHT DATA...';
    const resp = await fetch('https://logbook-api.martindaoust33.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: b64 } },
            { type: 'text', text: `This is a page from a Canadian ICAO pilot logbook. Extract ALL flight entries visible.
RESPOND WITH ONLY A JSON ARRAY. NO TEXT BEFORE OR AFTER. START WITH [ END WITH ].
[{"date":"YYYY-MM-DD","type":"","reg":"","pic":"","copilot":"","route":"","total":0,"meDayPic":0,"meNightPic":0,"meDayDual":0,"meNightDual":0,"meDayCop":0,"meNightCop":0,"xcDayPic":0,"xcNightPic":0,"xcDayDual":0,"xcNightDual":0,"ldgDay":0,"ldgNight":0,"instActual":0,"picus":0,"block":0}]
Use 0 for empty fields. Infer year from context if not explicit.` }
          ]
        }]
      })
    });

    const data = await resp.json();
    const text = data.content?.map(c => c.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(clean);
    box.classList.remove('show');
    showImportPreview(extracted, `${extracted.length} flight${extracted.length !== 1 ? 's' : ''} extracted from photo — review before import`);
  } catch(e) {
    box.classList.remove('show');
    showToast('Could not parse image — try a clearer photo', 'error');
    console.error(e);
  }
}

function toggleNavbluePanel() {
  const p = document.getElementById('navbluePanel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

async function parseNavbluePDF(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  document.getElementById('navbluePanel').style.display = 'none';

  const box = document.getElementById('aiBox');
  const msg = document.getElementById('aiMsg');
  box.classList.add('show');
  msg.textContent = 'READING NAVBLUE ROSTER PDF...';

  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  try {
    msg.textContent = 'AI EXTRACTING FLIGHTS...';
    const resp = await fetch('https://logbook-api.martindaoust33.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        system: 'You are a data extraction API. You ONLY output valid JSON arrays. Never include explanations, markdown, or text outside the JSON array. If you cannot extract anything, return [].',
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: `This is a Porter Airlines Navblue HrRosterReport PDF. Extract ONLY real flight legs Martin Daoust operated as F/O.

SKIP these activity codes (NOT flights): VAC, GD, SDO, REAX, HTL, PER, LM, BO, DH, RDG, P32### (P followed by 5 digits = deadhead positioning).

KEEP only PD### flights (Porter mainline) where Martin was crew operating.

Output a JSON array. If nothing to extract, output [].
Format per flight:
{"date":"YYYY-MM-DD","flightNum":"PD150","type":"E195-E2","reg":"C-XXXX","pic":"Captain Name","copilot":"M. Daoust","route":"YOW-YYZ","block":1.10,"duty":1.50,"total":1.10,"meDayCop":1.10,"meNightCop":0,"meDayPic":0,"meNightPic":0,"meDayDual":0,"meNightDual":0,"xcDayPic":0,"xcNightPic":0,"xcDayDual":0,"xcNightDual":0,"ldgDay":1,"ldgNight":0,"instActual":0,"picus":0}

RULES:
- Only completed flights (date <= today)
- BLH column = block hours (convert HH:MM to decimal, e.g. 4:30 → 4.50)
- Pilot is F/O (SIC): put block into meDayCop (day landings) or meNightCop (night landings)
- ldgDay/ldgNight: 1 per leg landing during day/night
- type: "E195-E2" for 295, "DH4" for Dash 8 Q400` }
          ]
        }]
      })
    });

    const rawText = await resp.text();
    console.log('[Navblue] Worker HTTP status:', resp.status);
    console.log('[Navblue] Worker raw response (first 500 chars):', rawText.substring(0, 500));

    if (!resp.ok) {
      throw new Error(`Worker error ${resp.status}: ${rawText.substring(0, 200)}`);
    }

    let data;
    try { data = JSON.parse(rawText); } catch(e) {
      throw new Error('Worker did not return JSON. Response: ' + rawText.substring(0, 200));
    }

    // Anthropic API error inside the worker response?
    if (data.error) {
      throw new Error(`Anthropic API error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const text = data.content?.map(c => c.text || '').join('') || '';
    console.log('[Navblue] AI response text (first 800 chars):', text.substring(0, 800));

    if (!text.trim()) {
      throw new Error('AI returned empty response. Check worker logs / API key.');
    }

    // Strip markdown fences if present
    const clean = text.replace(/```(?:json)?/gi, '').trim();

    // Find a JSON array — prefer the largest [...] block (handles nested objects)
    let match = clean.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) match = clean.match(/\[\s*\]/);  // empty array fallback
    if (!match) {
      // The AI replied with text instead of JSON — surface what it said
      throw new Error(`AI did not return JSON. It said: "${clean.substring(0, 250)}"`);
    }

    let extracted;
    try { extracted = JSON.parse(match[0]); } catch(e) {
      throw new Error('Malformed JSON from AI: ' + match[0].substring(0, 200));
    }

    if (!Array.isArray(extracted) || extracted.length === 0) {
      throw new Error('AI found no flights to import in this PDF.');
    }

    const today = new Date().toISOString().split('T')[0];
    // Strict: only flights from BEFORE today (today's flight may still be in progress)
    const filtered = extracted.filter(f => f.date && f.date < today && f.block > 0);
    console.log(`[Navblue] Extracted ${extracted.length} entries, ${filtered.length} after filtering completed flights (date < today, block > 0).`);

    if (filtered.length === 0) {
      throw new Error(`AI extracted ${extracted.length} entries but none are completed (date must be before today and block > 0).`);
    }

    box.classList.remove('show');
    showImportPreview(filtered, `${filtered.length} flight${filtered.length !== 1 ? 's' : ''} extracted from Navblue PDF — review before import`);
  } catch(e) {
    box.classList.remove('show');
    showToast(e.message || 'Could not parse PDF', 'error');
    console.error('[Navblue] Error:', e);
  }
}

function handleDrop(event, type) {
  event.preventDefault();
  document.getElementById(type+'Zone').classList.remove('dragover');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (type === 'photo') {
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('photoInput').files = dt.files;
    handlePhotoImport(document.getElementById('photoInput'));
  }
}

function showImportPreview(list, subtitle) {
  // Each entry gets a `selected` flag (default true)
  pendingImport = list.map(f => ({ ...f, selected: true }));
  const sub = document.getElementById('importSubtitle');
  if (sub) sub.textContent = subtitle || `${list.length} flight${list.length !== 1 ? 's' : ''} found — select what to import`;
  renderImportPreview();
  const overlay = document.getElementById('importPreview');
  overlay.classList.add('show');
  // Lock body scroll while modal is open
  document.body.style.overflow = 'hidden';
}

function renderImportPreview() {
  const container = document.getElementById('extractedList');
  if (!pendingImport.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">No flights found.</p>';
    updateImportButton();
    return;
  }
  container.innerHTML = `
    <div class="import-bulk-bar">
      <span class="eyebrow" id="importCount">0 of 0 selected</span>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllImport(true)">Select all</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="toggleAllImport(false)">Deselect all</button>
      </div>
    </div>
    ${pendingImport.map((f, i) => `
      <label class="review-item ${f.selected ? 'is-selected' : 'is-deselected'}" for="imp-${i}">
        <input type="checkbox" id="imp-${i}" class="review-check"
               ${f.selected ? 'checked' : ''}
               onchange="toggleImportItem(${i}, this.checked)">
        <div class="review-body">
          <div class="review-item-header">#${i+1} · ${esc(f.date)} · ${esc(f.flightNum || f.reg || '?')} · ${esc(f.route || '?')}</div>
          <div class="review-fields">
            <div class="review-field"><span>Total</span> ${+f.total||0}h</div>
            <div class="review-field"><span>Block</span> ${+f.block || 0}h</div>
            <div class="review-field"><span>PIC Day</span> ${+f.meDayPic || 0}h</div>
            <div class="review-field"><span>PIC Night</span> ${+f.meNightPic || 0}h</div>
            ${(f.meDayCop || f.meNightCop) ? `<div class="review-field"><span>SIC</span> ${((+f.meDayCop||0)+(+f.meNightCop||0)).toFixed(2)}h</div>` : ''}
            <div class="review-field"><span>Ldg</span> ${(+f.ldgDay || 0) + (+f.ldgNight || 0)}</div>
            ${f.pic ? `<div class="review-field"><span>PIC</span> ${esc(f.pic)}</div>` : ''}
          </div>
        </div>
      </label>`).join('')}
  `;
  updateImportButton();
}

function toggleImportItem(idx, checked) {
  if (pendingImport[idx]) pendingImport[idx].selected = checked;
  // Toggle visual class on the label without full re-render (keeps scroll position)
  const el = document.querySelector(`label[for="imp-${idx}"]`);
  if (el) {
    el.classList.toggle('is-selected', checked);
    el.classList.toggle('is-deselected', !checked);
  }
  updateImportButton();
}

function toggleAllImport(checked) {
  pendingImport.forEach(f => f.selected = checked);
  renderImportPreview();
}

function updateImportButton() {
  const selected = pendingImport.filter(f => f.selected).length;
  const total = pendingImport.length;
  const counter = document.getElementById('importCount');
  if (counter) counter.textContent = `${selected} of ${total} selected`;
  const btn = document.getElementById('importConfirmBtn');
  if (btn) {
    btn.textContent = selected > 0 ? `✅ Import ${selected} flight${selected !== 1 ? 's' : ''}` : 'Nothing to import';
    btn.disabled = selected === 0;
  }
}

function confirmImport() {
  const toImport = pendingImport.filter(f => f.selected);
  const count = toImport.length;
  if (count === 0) {
    showToast('Nothing selected to import', 'error');
    return;
  }
  toImport.forEach(f => {
    const { selected, ...flightData } = f;  // strip the selected flag
    flights.push({ ...flightData, id: Date.now().toString() + Math.random() });
  });
  DB.save(flights);
  pendingImport = [];
  closeImportOverlay();
  showToast(count + ' flight' + (count !== 1 ? 's' : '') + ' imported ✓', 'success');
  showPage('logbook');
}

function cancelImport() {
  pendingImport = [];
  closeImportOverlay();
}

function closeImportOverlay() {
  const overlay = document.getElementById('importPreview');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

// Close modals on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const importOverlay = document.getElementById('importPreview');
    if (importOverlay && importOverlay.classList.contains('show')) { cancelImport(); return; }
    const detailOverlay = document.getElementById('flightDetailOverlay');
    if (detailOverlay && detailOverlay.classList.contains('show')) closeFlightDetail();
  }
});

