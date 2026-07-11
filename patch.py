import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

old = '<div class="nav-logo">JadeKey</div>'
assert old in content, "nav-logo not found"

button_html = '''<div class="nav-logo">JadeKey</div>
  <button id="scan-stone-btn" class="nav-scan-btn">Сканировать камень</button>'''

content = content.replace(old, button_html, 1)

modal_html = '''
<div id="scan-qr-modal" class="scan-modal" style="display:none;">
  <div class="scan-modal-content">
    <span class="scan-modal-close">&times;</span>
    <p>Отсканируйте QR-код телефоном</p>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=https://14101965.xyz" alt="QR код сканера">
  </div>
</div>
'''

content = content.replace('</nav>', '</nav>' + modal_html, 1)

script_style = '''
<script>
(function() {
const scanUrl = "https://14101965.xyz";
const btn = document.getElementById('scan-stone-btn');
const modal = document.getElementById('scan-qr-modal');
const closeBtn = document.querySelector('.scan-modal-close');
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

btn.addEventListener('click', function() {
  if (isMobile) {
    window.location.href = scanUrl;
  } else {
    modal.style.display = 'flex';
  }
});

if (closeBtn) {
  closeBtn.addEventListener('click', function() {
    modal.style.display = 'none';
  });
}
})();
</script>
<style>
.nav-scan-btn {
  background: none; border: 1px solid #c8964a; color: #c8964a;
  padding: 6px 14px; border-radius: 20px; font-size: 13px;
  cursor: pointer; margin-left: 16px;
}
.scan-modal {
  position: fixed; top:0; left:0; width:100%; height:100%;
  background: rgba(0,0,0,0.7); display: flex;
  align-items: center; justify-content: center; z-index: 9999;
}
.scan-modal-content {
  background: #fff; padding: 24px; border-radius: 12px;
  text-align: center; position: relative;
}
.scan-modal-close {
  position: absolute; top: 8px; right: 12px;
  cursor: pointer; font-size: 24px; color: #333;
}
</style>
'''

content = content.replace('</body>', script_style + '\n</body>', 1)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("OK, patched")
