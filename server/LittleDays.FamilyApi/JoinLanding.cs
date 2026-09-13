using System.Security.Cryptography;

namespace LittleDays.FamilyApi;

public static class JoinLanding
{
    public static IResult Render(HttpContext context)
    {
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
        context.Response.Headers.ContentSecurityPolicy = $"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'none'";
        context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
        return Results.Content($$"""
            <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <meta name="referrer" content="no-referrer"><title>Little Days family invitation</title>
            <style nonce="{{nonce}}">body{font:18px/1.6 system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:1.5rem;background:#faf7f2;color:#263b35}h1{font-size:2rem;line-height:1.2}button,input{font:inherit;padding:.8rem;border-radius:.5rem}button{background:#285c49;color:white;border:0;cursor:pointer}button:disabled{opacity:.5;cursor:default}input{box-sizing:border-box;width:100%;border:1px solid #b7c2ba}label{display:block;margin-top:2rem}small{display:block;margin-top:1rem}</style></head>
            <body><main><h1>A Little Days family invitation</h1>
            <p id="message">Open Little Days, sign in with the invited pilot account, then choose to join. Opening this page does not accept the invitation.</p>
            <button id="open" disabled>Open Little Days</button>
            <label for="link">If the app does not open, copy this link and paste it into the app’s family invitation field.</label>
            <input id="link" readonly aria-label="Invitation link" autocomplete="off" spellcheck="false">
            <small>This private pilot uses test bottle feeds only. Keep your invitation link private.</small></main>
            <script nonce="{{nonce}}">
            (() => {
              const fragment = new URLSearchParams(location.hash.slice(1));
              const token = fragment.get('token') || '';
              const valid = fragment.getAll('token').length === 1 && /^[A-Za-z0-9_-]{43}$/.test(token);
              history.replaceState(null, '', location.pathname);
              if (!valid) { document.getElementById('message').textContent = 'This invitation link is incomplete. Ask the family owner for a new link.'; return; }
              document.getElementById('link').value = location.origin + '/join#token=' + token;
              const button = document.getElementById('open');
              button.disabled = false;
              button.addEventListener('click', () => { location.href = 'mylittledays://family-invite#token=' + token; });
            })();
            </script></body></html>
            """, "text/html; charset=utf-8");
    }
}
