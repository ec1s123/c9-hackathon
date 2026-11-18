// Search box with a grouped result list. The caller supplies the results;
// this file only handles opening, keyboard movement and picking.
//   results(query) -> [{ group, html, pick() }]
export function initSearch(input, pop, results) {
  let items = [], cur = -1;

  const close = () => { pop.hidden = true; input.setAttribute('aria-expanded', 'false'); cur = -1; };
  const mark = () => {
    pop.querySelectorAll('[role=option]').forEach((el, i) => {
      el.classList.toggle('cur', i === cur);
      el.setAttribute('aria-selected', i === cur);
      if (i === cur) { el.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', el.id); }
    });
    if (cur < 0) input.removeAttribute('aria-activedescendant');
  };
  const open = () => {
    const q = input.value.trim();
    items = results(q);
    let html = '', group = null;
    items.forEach((it, i) => {
      if (it.group !== group) { group = it.group; html += `<div class="pop-group">${group}</div>`; }
      html += `<div class="pop-item" role="option" id="sr${i}" data-i="${i}">${it.html}</div>`;
    });
    pop.innerHTML = html || `<div class="pop-empty">Nothing matches “${q.replace(/[&<>]/g, '')}”. Try a team, a player's in-game name, an agent or a map.</div>`;
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    cur = q && items.length ? 0 : -1;
    mark();
  };
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    input.value = '';
    close();
    input.blur();
    it.pick();
  };

  input.addEventListener('input', open);
  input.addEventListener('focus', open);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (pop.hidden) input.blur(); else close(); return; }
    if (pop.hidden) { if (e.key === 'ArrowDown') open(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(cur >= 0 ? cur : 0);
    }
  });
  // mousedown, not click: it fires before the input loses focus
  pop.addEventListener('mousedown', (e) => {
    const el = e.target.closest('[role=option]');
    e.preventDefault();
    if (el) pick(+el.dataset.i);
  });
  pop.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[role=option]');
    if (el && +el.dataset.i !== cur) { cur = +el.dataset.i; mark(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 0));
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.focus(); }
  });
}
