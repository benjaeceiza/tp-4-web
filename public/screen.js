const statusEl = document.getElementById('connection-status');
const countEl = document.getElementById('screen-participant-count');
const participantsListEl = document.getElementById('screen-participants-list');
const productsListEl = document.getElementById('screen-products-list');

const eventSource = new EventSource('/events');

eventSource.addEventListener('open', () => {
  statusEl.textContent = 'En vivo (SSE conectado)';
  statusEl.style.background = '#dcfce7';
  statusEl.style.color = '#166534';
});

eventSource.addEventListener('error', () => {
  statusEl.textContent = 'Reconectando SSE...';
  statusEl.style.background = '#fee2e2';
  statusEl.style.color = '#991b1b';
});

eventSource.addEventListener('state_update', (event) => {
  const data = JSON.parse(event.data);
  renderScreen(data);
});

function renderScreen(data) {
  countEl.textContent = String(data.participantCount);

  if (data.participants.length === 0) {
    participantsListEl.innerHTML = '<span style="color:#64748b; font-size:14px;">Ningún participante conectado</span>';
  } else {
    participantsListEl.innerHTML = data.participants
      .map((name) => `<span class="badge">${escapeHtml(name)}</span>`)
      .join('');
  }

  if (data.products.length === 0) {
    productsListEl.innerHTML = '<p style="color:#64748b;">Aún no hay productos en el ranking.</p>';
    return;
  }

  productsListEl.innerHTML = data.products
    .map((p, index) => {
      const position = index + 1;
      return `
        <div class="product-item">
          <div class="product-info">
            <div style="font-size: 22px; font-weight: 800; color: #64748b; width: 36px; text-align: center;">
              #${position}
            </div>
            <img src="${escapeHtml(p.thumbnail)}" alt="${escapeHtml(p.title)}" />
            <div>
              <strong style="font-size: 17px;">${escapeHtml(p.title)}</strong>
              <span style="color: #64748b; font-size: 13px;">(ID #${p.id})</span>
              <div style="font-size: 15px; color: #0f172a; margin: 4px 0;">Precio: $${p.price}</div>
              <div style="font-size: 12px; color: #64748b;">
                Propuesto por: <strong>${escapeHtml(p.proposedBy)}</strong>
              </div>
            </div>
          </div>

          <div class="vote-count" style="font-size: 22px;">
            ${p.voteCount} voto${p.voteCount === 1 ? '' : 's'}
          </div>
        </div>
      `;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}