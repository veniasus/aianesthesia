// Helpers injected into the Bubble editor (Backend Workflows tab) via Playwright's
// browser_evaluate. They drive the expression composer and property editor.
// Re-inject after any page reload. See docs/response-api-migration.md.
(() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = e => (e.innerText ?? e.textContent ?? '').trim();
  const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const esc = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300); };
  const W = window;
  W.__sleep = sleep; W.__esc = esc;

  W.__clickAt = (el) => {
    const r = el.getBoundingClientRect(); const x = r.left + Math.min(20, r.width / 2), y = r.top + r.height / 2;
    const t = document.elementFromPoint(x, y) || el;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  };
  W.__segs = () => [...document.querySelectorAll('[role=combobox]')].filter(e => e.offsetParent !== null).map((c, i) => i + ':' + c.innerText.replace(/\s+/g, ' ').trim().slice(0, 40));
  W.__card = (n) => { const t = document.body.innerText; const i = t.indexOf('Step ' + n); return t.slice(i, i + 160).replace(/\n+/g, ' | '); };
  W.__selectStep = async (n) => {
    const lab = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && txt(e) === 'Step ' + n && e.offsetParent !== null);
    if (!lab) return 'step not found';
    lab.closest('[role=button]').click(); await sleep(1200); return W.__card(n);
  };
  // pick an option in the open dropdown, or open the trailing slot first
  W.__pick = async (text) => {
    let box = document.querySelector('[role=combobox][aria-expanded="true"]');
    if (!box) {
      const slots = [...document.querySelectorAll('.dropdown-container.new-composer')].filter(e => e.offsetParent !== null);
      const target = slots[slots.length - 1]; if (!target) return 'no slot';
      W.__clickAt(target); await sleep(700);
      box = document.querySelector('[role=combobox][aria-expanded="true"]');
      if (!box) return 'no combobox opened';
    }
    const search = box.querySelector('input');
    if (search) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(search, text); search.dispatchEvent(new Event('input', { bubbles: true })); await sleep(700); }
    let opts = [], tries = 0;
    while (tries++ < 6) { opts = [...document.querySelectorAll('[role=listbox] [role=option]')].filter(o => o.offsetParent !== null); if (opts.length) break; await sleep(300); }
    const opt = opts.find(o => norm(o.innerText) === norm(text)) || opts.find(o => norm(o.innerText).startsWith(norm(text))) || opts.find(o => norm(o.innerText).includes(norm(text)));
    if (!opt) return 'option not found: ' + text + ' | have: ' + opts.map(o => o.innerText.trim()).slice(0, 15).join(' ; ');
    opt.click(); await sleep(700); return 'picked: ' + opt.innerText.trim();
  };
  W.__pickSeg = async (idx, text) => {
    const boxes = [...document.querySelectorAll('[role=combobox]')].filter(e => e.offsetParent !== null);
    const b = boxes[idx]; if (!b) return 'no seg ' + idx;
    if (b.getAttribute('aria-expanded') !== 'true') { b.click(); await sleep(600); }
    return await W.__pick(text);
  };
  // open the property-editor field next to a label (e.g. 'Only when')
  W.__openField = async (label) => {
    const labEl = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && txt(e) === label && e.offsetParent !== null).pop();
    if (!labEl) return 'label not found';
    const row = labEl.parentElement; const target = row.querySelector('button') || [...row.children].find(c => c !== labEl);
    if (!target) return 'no field next to label';
    W.__clickAt(target); await sleep(900);
    if (!document.querySelector('[role=combobox]')) { target.click(); await sleep(900); }
    return W.__segs();
  };
  // re-point segment idx of an existing expression, then append tail picks
  W.__repoint = async (step, label, idx, newSource, tail) => {
    const s = await W.__selectStep(step);
    const segs = await W.__openField(label); if (typeof segs === 'string') return { s, err: segs };
    if (document.querySelector('[role=combobox][aria-expanded="true"]')) await esc();
    const rs = [await W.__pickSeg(idx, newSource)];
    for (const t of tail) { await sleep(300); rs.push(await W.__pick(t)); }
    await sleep(300); await esc(); return { s, rs, segs: W.__segs() };
  };
  // build a condition from scratch on the selected step (field must be empty)
  W.__buildCond = async (picks, label = 'Only when') => {
    const labEl = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && txt(e) === label && e.offsetParent !== null).pop();
    const row = labEl.parentElement; const btn = row.querySelector('button') || [...row.children].find(c => c !== labEl);
    W.__clickAt(btn); await sleep(800); if (!document.querySelector('[role=combobox]')) { btn.click(); await sleep(800); }
    const rs = []; for (const p of picks) { rs.push(await W.__pick(p)); await sleep(400); }
    await sleep(300); await esc(); return rs;
  };
  // right-click context menu on a field (returns menu items) and click one
  W.__ctx = async (labelText) => {
    const lab = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && txt(e) === labelText && e.offsetParent !== null);
    if (!lab) return 'label not found';
    const row = lab.closest('.prop-row-contents') || lab.parentElement; const body = row.querySelector('.body') || [...row.children].find(c => c !== lab);
    const r = body.getBoundingClientRect(); const x = r.left + r.width - 15, y = r.top + r.height / 2;
    (document.elementFromPoint(x, y) || body).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); await sleep(600);
    return [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && /expression$/.test(txt(e)) && e.offsetParent !== null).map(i => txt(i));
  };
  W.__menu = async (text) => { const it = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && txt(e) === text && e.offsetParent !== null); if (!it) return 'no menu item'; it.click(); await sleep(800); return 'clicked ' + text; };
  W.__clearCond = async (label = 'Only when') => { await W.__ctx(label); return await W.__menu('Clear expression'); };
  // property editor text (around the Only when label)
  W.__pe = () => { const l = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && txt(e) === 'Only when' && e.offsetParent !== null).pop(); let b = l; for (let i = 0; i < 5; i++) b = b.parentElement; return b.innerText.replace(/\n+/g, ' | ').slice(0, 700); };
  // text-with-dynamic-data field: clear it and insert a dynamic expression built from picks
  W.__setTextField = async (labelText, picks) => {
    const lab = [...document.querySelectorAll('div')].find(e => e.getAttribute('title') === labelText || (e.childElementCount === 0 && txt(e) === labelText && e.offsetParent !== null));
    if (!lab) return 'label not found';
    const row = lab.closest('.prop-row-contents') || lab.parentElement; const tc = row.querySelector('.text-composer');
    W.__clickAt(tc); await sleep(500); document.execCommand('selectAll'); document.execCommand('delete'); await sleep(300);
    const btn = [...document.querySelectorAll('.insert-dynamic-button')].find(e => e.offsetParent !== null); if (!btn) return 'no insert button';
    W.__clickAt(btn); await sleep(900); if (!document.querySelector('[role=combobox]')) { btn.click(); await sleep(900); }
    const rs = []; for (const p of picks) { rs.push(await W.__pick(p)); await sleep(300); }
    await esc(); await sleep(300); return { rs, row: row.innerText.replace(/\n/g, '|').slice(0, 160) };
  };
  // text-with-dynamic-data field: clear it and paste the copied expression
  W.__pasteTextField = async (labelText) => {
    const lab = [...document.querySelectorAll('div')].find(e => e.getAttribute('title') === labelText || (e.childElementCount === 0 && txt(e) === labelText && e.offsetParent !== null));
    if (!lab) return 'label not found';
    const row = lab.closest('.prop-row-contents') || lab.parentElement; const tc = row.querySelector('.text-composer');
    W.__clickAt(tc); await sleep(500); document.execCommand('selectAll'); document.execCommand('delete'); await sleep(300);
    const btn = [...document.querySelectorAll('.insert-dynamic-button')].find(e => e.offsetParent !== null); if (!btn) return 'no insert button';
    W.__clickAt(btn); await sleep(900); await esc();
    const box = [...document.querySelectorAll('[role=combobox]')].find(e => e.offsetParent !== null); if (!box) return 'no combobox';
    const r = box.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    (document.elementFromPoint(x, y) || box).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); await sleep(600);
    const m = await W.__menu('Paste expression'); await sleep(500); await esc();
    return { m, row: row.innerText.replace(/\n/g, '|').slice(0, 160) };
  };
  // add an action after step n via the picker
  W.__addAction = async (afterStep, actionName) => {
    const lab = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && txt(e) === 'Step ' + afterStep && e.offsetParent !== null);
    let node = lab.closest('[role=button]'); while (node && !(node.nextElementSibling && /^Add$/.test(txt(node.nextElementSibling)))) node = node.parentElement;
    const add = node && node.nextElementSibling; if (!add) return 'no Add button';
    add.click(); await sleep(1200);
    const search = document.querySelector('input[aria-label="Search for an action"]') || [...document.querySelectorAll('input')].find(i => /Search for an action/.test(i.placeholder || i.getAttribute('aria-label') || ''));
    if (!search) return 'no picker';
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(search, actionName); search.dispatchEvent(new Event('input', { bubbles: true })); await sleep(900);
    const item = [...document.querySelectorAll('div')].find(e => e.childElementCount === 0 && txt(e) === actionName && e.offsetParent !== null);
    if (!item) return 'action not in picker';
    item.click(); await sleep(1500); return W.__card(afterStep + 1);
  };
  return 'helpers injected';
})();
