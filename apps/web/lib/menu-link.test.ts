import { describe, expect, it } from 'vitest';
import { menuLinkTarget, resolveMenuLink } from './menu-link';

const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('kısa menü bağlantısı (/m/<token>)', () => {
  it('geçerli token dükkan adresine çözülür; hedef vitrin token’ı taşır', async () => {
    const urls: string[] = [];
    const slug = await resolveMenuLink('Ab3xK9pQw2Zt', async (input) => {
      urls.push(input);
      return ok({ slug: 'deneme-isletmesi' })();
    }, 'http://api:4000/');
    expect(slug).toBe('deneme-isletmesi');
    expect(urls).toEqual(['http://api:4000/api/v1/public/menu-link/Ab3xK9pQw2Zt']);
    expect(menuLinkTarget('deneme-isletmesi', 'Ab3xK9pQw2Zt')).toBe('/s/deneme-isletmesi?l=Ab3xK9pQw2Zt');
  });

  it('süresi dolmuş (404), bozuk yanıt, ağ hatası ve biçimsiz token null döner', async () => {
    expect(await resolveMenuLink('Ab3xK9pQw2Zt', ok({ error: { code: 'not_found' } }, 404))).toBeNull();
    expect(await resolveMenuLink('Ab3xK9pQw2Zt', ok({ slug: 42 }))).toBeNull();
    expect(await resolveMenuLink('Ab3xK9pQw2Zt', async () => { throw new Error('ağ'); })).toBeNull();
    let called = false;
    expect(await resolveMenuLink('../../admin', async () => { called = true; return ok({ slug: 'x' })(); })).toBeNull();
    expect(called).toBe(false);
  });
});
