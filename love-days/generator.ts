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
        const r = await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',max_tokens:160,messages:[{role:'system',content:'Напиши одну оригинальную русскую любовную записку от первого лица любимому человеку. 1–3 коротких предложения, нежная бытовая деталь и лёгкий юмор, без клише, названий и кавычек. Сцена должна легко иллюстрироваться. Не повторяй недавние записки.'},{role:'user',content:JSON.stringify(recent).slice(-3500)}]})});
        if (!r.ok) throw Error('Text API HTTP '+r.status);
        message=(await r.json()).choices?.[0]?.message?.content?.trim();
        if (!message || message.length>700) throw Error('Invalid message');
      }
      const form=new FormData();
      for(const [k,v] of Object.entries({model:'gpt-image-1-mini',quality:'medium',size:'1024x1024',n:'1',output_format:'jpeg',output_compression:'72',prompt:'Paint one new square watercolor scene illustrating this Russian love note: '+message+' . Use the supplied reference for the same two striped agate characters: pink and green stones with tiny limbs, their distinctive faces and watercolor texture. Build a new location, gesture and props specific to the note. No text or letters.'})) form.append(k,v);
      form.append('image',new Blob([Buffer.from(reference,'base64')],{type:'image/jpeg'}),'agate.jpg');
      const result=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:headers(),body:form,signal:AbortSignal.timeout(200000)});
      if(!result.ok) throw Error('Image API HTTP '+result.status);
      const img=(await result.json()).data?.[0]?.b64_json;
      if(!img) throw Error('Missing image');
      return Response.json({text:message,image:img},{headers:{'Cache-Control':'no-store'}});
    } catch(e){console.error(String(e).slice(0,100));return new Response('Card generation failed',{status:502});}
  }
};
