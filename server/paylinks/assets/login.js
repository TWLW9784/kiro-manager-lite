document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.currentTarget
  const err = document.getElementById('login-error')
  const btn = form.querySelector('button')
  err.textContent = ''
  btn.disabled = true
  try {
    const res = await fetch('api.php?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value })
    })
    const data = await res.json().catch(() => ({}))
    if (data.ok) location.reload()
    else err.textContent = tError(data, 'login_failed')
  } catch {
    err.textContent = t('network_error')
  } finally {
    btn.disabled = false
  }
})
