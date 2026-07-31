// Scroll-reveal for elements with class "reveal"
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

// Lightbox: click (or Enter/Space) any .zoomable screenshot to see it at
// full size instead of cropped inside its showcase/gallery frame.
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');

function openLightbox(trigger) {
  const img = trigger.querySelector('img');
  if (!img || !lightbox || !lightboxImg) return;
  // currentSrc reflects whichever <source> the browser actually picked
  // (light/dark), so the lightbox always matches what's on the card.
  lightboxImg.src = img.currentSrc || img.src;
  lightboxImg.alt = img.alt;
  lightbox.hidden = false;
}

function closeLightbox() {
  if (!lightbox || !lightboxImg) return;
  lightbox.hidden = true;
  lightboxImg.src = '';
}

document.querySelectorAll('[data-action="openLightbox"]').forEach((el) => {
  el.addEventListener('click', () => openLightbox(el));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLightbox(el);
    }
  });
});

if (lightbox) {
  document.querySelector('[data-action="closeLightbox"]').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });
}
