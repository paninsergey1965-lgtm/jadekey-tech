function setupCheckoutFields(form, payButton) {
  const fields = form.elements;
  const consent = fields.termsAccepted;
  const hint = form.querySelector('#checkout-hint');
  let busy = false;

  function update() {
    const complete = fields.name.value.trim() && fields.phone.value.trim() &&
      fields.email.validity.valid && /^\S+@\S+\.\S+$/.test(fields.email.value) &&
      fields.delivery.value && fields.address.value.trim();
    if (!complete) consent.checked = false;
    consent.disabled = !complete;
    payButton.disabled = busy || !complete || !consent.checked;
    hint.hidden = Boolean(complete);
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('focusin', update);
  window.addEventListener('pageshow', update);
  update();

  return {
    ready() { update(); return !payButton.disabled; },
    setBusy(value) { busy = value; update(); }
  };
}
