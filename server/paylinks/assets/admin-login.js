// 管理后台登录。单独成文件（不内联）是为了让 CSP 不必开 script-src 'unsafe-inline'
document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault()
  const f = e.currentTarget
  const btn = f.querySelector('button')
  btn.disabled = true
  try {
    const res = await fetch('api.php?action=admin_login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.username.value.trim(), password: f.password.value })
    })
    const data = await res.json().catch(() => ({}))
    if (data.ok) location.reload()
    else document.getElementById('login-error').textContent = data.error || '登录失败'
  } finally {
    btn.disabled = false
  }
})
