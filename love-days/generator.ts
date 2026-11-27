// Railway function. Only the production calendar workflow may request an illustration.
import { createRemoteJWKSet, jwtVerify } from 'jose';
const issuer = 'https://token.actions.githubusercontent.com';
const keys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'));
const repo = 'paninsergey1965-lgtm/jadekey-tech';
const audience = 'jadekey-love-calendar';
const headers = () => ({ Authorization: 'Bearer ' + Bun.env.OPENAI_API_KEY });
export default {
  idleTimeout: 240,
  async fetch(req: Request) {
    const route = new URL(req.url).pathname;
    if (route === '/health') return new Response('ok');
    if (route !== '/generate' || req.method !== 'POST') return new Response('', {status:404});
    try {
      const {payload} = await jwtVerify((req.headers.get('authorization') || '').replace(/^Bearer /,''), keys, {issuer,audience,algorithms:['RS256']});
      if (payload.workflow_ref !== repo + '/.github/workflows/love-day.yml@refs/heads/main' || payload.sub !== 'repo:' + repo + ':ref:refs/heads/main') return new Response('',{status:403});
    } catch { return new Response('',{status:401}); }
    try {
      const {text,reference,recent} = await req.json();
      if (typeof text !== 'string' || text.length > 700 || typeof reference !== 'string' || reference.length > 32000) return new Response('',{status:400});
      let message = text;
      if (!message) {
        const r = await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',max_tokens:160,messages:[{role:'system',content:'Придумай одну короткую естественную реплику для кадра романтической манги. Двое взрослых героев в городе, лёгкий флирт в конкретной ситуации. Реплика одного героя другому, до 12 слов. Не обращайся к читателю, не предполагай совместного быта. Ответ только репликой, без кавычек. Не повторяй недавние сюжеты.'},{role:'user',content:JSON.stringify(recent).slice(-3500)}]})});
        if (!r.ok) throw Error('Text API HTTP '+r.status);
        message=(await r.json()).choices?.[0]?.message?.content?.trim();
        if (!message || message.length>700) throw Error('Invalid message');
      }
      const form=new FormData();
      for(const [k,v] of Object.entries({model:'gpt-image-1-mini',quality:'medium',size:'1024x1024',n:'1',output_format:'jpeg',output_compression:'72',prompt:'Draw a cinematic full-color romantic manga panel with the two adults in the reference. Keep her black bob and jade barrette, his auburn curls and freckles, warm vintage ink and fine print grain. Invent a fresh setting and physical action that makes this line of dialogue meaningful: '+message+'. Art only, no captions or lettering.'})) form.append(k,v);
      form.append('image',new Blob([Buffer.from(reference,'base64')],{type:'image/jpeg'}),'couple.jpg');
      const result=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:headers(),body:form,signal:AbortSignal.timeout(200000)});
      if(!result.ok) throw Error('Image API HTTP '+result.status);
      const img=(await result.json()).data?.[0]?.b64_json;
      if(!img) throw Error('Missing image');
      return Response.json({text:message,image:img},{headers:{'Cache-Control':'no-store'}});
    } catch(e){console.error(String(e).slice(0,100));return new Response('Card generation failed',{status:502});}
  }
};
