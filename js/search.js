(function () {
  var input = document.getElementById('q'), out = document.getElementById('results');
  if (!input || !out) return;
  var q0 = new URLSearchParams(location.search).get('q') || ''; input.value = q0;
  var index = [];
  fetch('/data/search-index.json').then(function (r) { return r.json(); }).then(function (d) { index = d; render(input.value); });
  function esc(s) { var x = document.createElement('div'); x.textContent = s; return x.innerHTML; }
  function render(query) {
    var terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) { out.innerHTML = ''; return; }
    var hits = index.filter(function (r) { var t = (r.title + ' ' + r.description + ' ' + r.type).toLowerCase(); return terms.every(function (w) { return t.indexOf(w) !== -1; }); }).slice(0, 40);
    out.innerHTML = hits.length ? hits.map(function (r) { return '<li><a href="' + r.url + '">' + esc(r.title) + '</a><span>' + esc(r.type) + ' · ' + esc(r.description) + '</span></li>'; }).join('')
      : '<li>No results for &ldquo;' + esc(query) + '&rdquo;.</li>';
  }
  var t; input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () {
    var u = new URL(location); input.value ? u.searchParams.set('q', input.value) : u.searchParams.delete('q'); history.replaceState({}, '', u); render(input.value); }, 120); });
  document.getElementById('search-form').addEventListener('submit', function (e) { e.preventDefault(); render(input.value); });
})();
