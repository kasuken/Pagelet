/* Fictional, session-only design interactions. No API, payments, or persistence. */
const products = {
  website: { title: 'Build a website that feels like you', type: 'course', price: '$49', kind: 'Video course', copy: 'A thoughtful, practical course for independent makers. Go from an idea in your notebook to a place of your own online.', includes: ['12 short video lessons, at your own pace', 'A practical website brief and launch checklist', 'Captions, transcripts, and downloadable resources'], published: true },
  workbook: { title: 'The website launch workbook', type: 'download', price: '$12', kind: 'PDF workbook', copy: 'Thirty-two useful pages to turn your website idea into a plan you can actually follow.', includes: ['Audience and content planning exercises', 'A page-by-page website brief', 'An actionable launch-day checklist'], published: true },
  toolkit: { title: 'The independent portfolio toolkit', type: 'download', price: '$24', kind: 'Digital toolkit', copy: 'Give your work a clear, considered presentation with flexible starting points and a little guidance.', includes: ['Portfolio planning templates', 'Case study writing prompts', 'A practical PDF guide in a ZIP package'], published: true }
};
const lessons = [
  { title: 'A place for your ideas', slide: 'Your idea deserves a place of its own.', duration: '5 minutes', body: 'A personal website gives your work a clear home. Start by collecting three things you want a visitor to know about you. Keep them specific, useful, and recognizably yours.' },
  { title: 'Find the point of your page', slide: 'Give your website a reason to exist.', duration: '8 minutes', body: 'A good website starts with a clear purpose. Before thinking about typefaces or buttons, decide who you are helping and what you want them to do next. Write one sentence. Make that your starting point.' },
  { title: 'Make room for your content', slide: 'Start with what you want to say.', duration: '11 minutes', body: 'Gather your words, images, and examples before arranging the page. Group related ideas together. A useful heading helps someone find what they need without reading every sentence.' },
  { title: 'A first draft worth sharing', slide: 'Small, useful, and ready for the world.', duration: '9 minutes', body: 'Read your page on a small screen. Follow every link with your keyboard. Ask one person to explain what your site offers. Use what you learn to make the next version clearer.' }
];
let activeLesson = 1;
const completed = new Set([0]);
const views = ['shop', 'learning', 'studio'];
const main = document.querySelector('main');
function showView(name, focus = true) {
  if (!views.includes(name)) name = 'shop';
  views.forEach(view => {
    document.getElementById(`${view}-view`).hidden = view !== name;
    const button = document.querySelector(`[data-view="${view}"]`);
    if (view === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (focus) { main.focus(); window.scrollTo(0, 0); }
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  history.replaceState(null, '', `#${button.dataset.view}`);
  showView(button.dataset.view);
}));
window.addEventListener('hashchange', () => {
  const name = location.hash.slice(1);
  if (views.includes(name)) showView(name);
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  let count = 0;
  document.querySelectorAll('.product').forEach(card => {
    card.hidden = button.dataset.filter !== 'all' && card.dataset.type !== button.dataset.filter;
    if (!card.hidden) count++;
  });
  document.getElementById('product-count').textContent = `${count} ${count === 1 ? 'product' : 'products'}`;
}));
const productDialog = document.getElementById('product-dialog');
function openProduct(key) {
  const product = products[key];
  document.getElementById('dialog-title').textContent = product.title;
  document.getElementById('dialog-kind').textContent = product.kind;
  document.getElementById('dialog-copy').textContent = product.copy;
  document.getElementById('dialog-price').textContent = product.price;
  const list = document.getElementById('dialog-includes');
  list.replaceChildren(...product.includes.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  document.getElementById('explore-course').hidden = key !== 'website';
  productDialog.showModal();
}
document.querySelectorAll('[data-product]').forEach(button => button.addEventListener('click', () => openProduct(button.dataset.product)));
document.querySelectorAll('dialog .close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.getElementById('explore-course').addEventListener('click', () => {
  productDialog.close(); history.replaceState(null, '', '#learning'); showView('learning');
});
function renderLesson() {
  const lesson = lessons[activeLesson];
  document.getElementById('lesson-title').textContent = lesson.title;
  document.getElementById('slide-title').textContent = lesson.slide;
  document.getElementById('lesson-body').textContent = lesson.body;
  document.querySelector('.transcript p').textContent = lesson.body + ' Take a few minutes to try this with your own website idea before moving to the next lesson.';
  document.getElementById('lesson-duration').textContent = `Lesson ${activeLesson + 1} · ${lesson.duration}`;
  document.getElementById('complete-lesson').textContent = completed.has(activeLesson) ? 'Completed' : 'Mark complete';
  document.getElementById('complete-lesson').disabled = completed.has(activeLesson);
  document.getElementById('course-progress').value = completed.size;
  document.getElementById('course-progress').textContent = `${completed.size * 25}%`;
  document.getElementById('course-progress').setAttribute('aria-label', `${completed.size} of 4 sample lessons complete`);
  document.getElementById('progress-label').textContent = `${completed.size} of 4 sample lessons complete`;
  document.getElementById('lesson-list').replaceChildren(...lessons.map((item, index) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `lesson-link${completed.has(index) ? ' completed' : ''}`;
    if (index === activeLesson) button.setAttribute('aria-current', 'step');
    button.setAttribute('aria-label', `${item.title}${completed.has(index) ? ', completed' : ''}`);
    const number = document.createElement('span'); number.className = 'lesson-number'; number.setAttribute('aria-hidden', 'true'); number.textContent = completed.has(index) ? '✓' : index + 1;
    const title = document.createElement('span'); title.textContent = item.title; button.append(number, title);
    button.addEventListener('click', () => { activeLesson = index; renderLesson(); document.querySelectorAll('.lesson-link')[index].focus(); document.getElementById('learning-status').textContent = `Opened lesson ${index + 1}: ${item.title}.`; });
    return button;
  }));
}
document.getElementById('complete-lesson').addEventListener('click', () => {
  completed.add(activeLesson); renderLesson();
  document.getElementById('learning-status').textContent = 'Lesson marked complete for this preview. Production progress will be saved to your account.';
  document.querySelectorAll('.lesson-link')[activeLesson].focus();
});
document.getElementById('resource-info').addEventListener('click', () => openProduct('workbook'));
function setStudioTab(tab) {
  document.querySelectorAll('[data-studio-tab]').forEach(button => {
    button.classList.toggle('selected', button.dataset.studioTab === tab);
    if (button.dataset.studioTab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.getElementById('metrics').hidden = tab !== 'overview';
  document.getElementById('studio-products').hidden = tab === 'orders';
  document.getElementById('studio-orders').hidden = tab === 'products';
  document.getElementById('studio-title').textContent = { overview: 'A good day to make something.', products: 'A home for your good ideas.', orders: 'Every purchase has a story.' }[tab];
}
document.querySelectorAll('[data-studio-tab]').forEach(button => button.addEventListener('click', () => setStudioTab(button.dataset.studioTab)));
function renderProducts() {
  const rows = Object.entries(products).map(([key, product]) => {
    const row = document.createElement('tr');
    const name = document.createElement('td'); const group = document.createElement('div'); group.className = 'table-product';
    const cover = document.createElement('span'); cover.className = `table-cover ${product.type}`; cover.setAttribute('aria-hidden', 'true');
    const description = document.createElement('div'); const title = document.createElement('strong'); title.textContent = product.title;
    const kind = document.createElement('small'); kind.textContent = product.kind; description.append(title, kind); group.append(cover, description); name.append(group);
    const state = document.createElement('td'); const badge = document.createElement('span'); badge.className = `badge${product.published ? '' : ' draft'}`; badge.textContent = product.published ? 'Published' : 'Draft'; state.append(badge);
    const price = document.createElement('td'); price.textContent = product.price;
    const action = document.createElement('td'); const button = document.createElement('button'); button.type = 'button'; button.className = 'table-action'; button.textContent = 'Preview'; button.setAttribute('aria-label', `Preview ${product.title}`); button.addEventListener('click', () => openProduct(key)); action.append(button);
    row.append(name, state, price, action); return row;
  });
  document.getElementById('studio-product-rows').replaceChildren(...rows);
  document.getElementById('studio-product-count').textContent = `${rows.length} products`;
}
const createDialog = document.getElementById('create-dialog');
document.getElementById('new-product').addEventListener('click', () => createDialog.showModal());
document.getElementById('create-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('draft-title'); const title = input.value.trim();
  if (!title) { input.setCustomValidity('Enter a product name.'); input.reportValidity(); return; }
  const type = document.getElementById('draft-type').value;
  products[`draft-${Object.keys(products).length}`] = { title, type, kind: type === 'course' ? 'Video course' : 'Digital download', price: 'Not set', copy: 'A sample draft. The production editor will let you add content, set a price, and publish when you are ready.', includes: ['Details to add', 'Content to upload', 'Price to set'], published: false };
  renderProducts(); setStudioTab('products'); createDialog.close(); event.target.reset();
  document.getElementById('studio-status').textContent = `Created sample draft: ${title}. This temporary change disappears on reload.`;
});
document.getElementById('draft-title').addEventListener('input', event => event.target.setCustomValidity(''));
renderLesson(); renderProducts(); showView(location.hash.slice(1), false);
