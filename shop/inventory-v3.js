const documents = 'https://firestore.googleapis.com/v1/projects/jadekey-46f37/databases/(default)/documents';
const collection = 'jk2_stones';
const states = ['available','reserved','sold'];
function stoneFromDoc(doc) {
  const fields = doc.fields || {};
  return {id:doc.name.split('/').pop(), name:fields.name?.stringValue || '',
    state:fields.shopState?.stringValue || '', photo:fields.shopPreview?.stringValue || ''};
}
export async function readStone(id) {
  if (!/^[A-Za-z0-9]{20}$/.test(id)) throw new Error('Invalid stone');
  const url = documents+'/'+collection+'/'+id+'?mask.fieldPaths=name&mask.fieldPaths=shopState&mask.fieldPaths=shopPreview';
  const response = await fetch(url,{cache:'no-store'});
  if (response.status===404) return null;
  if (!response.ok) throw new Error('Stone unavailable');
  return stoneFromDoc(await response.json());
}
async function queryStock() {
  const query = {from:[{collectionId:collection}],select:{fields:[{fieldPath:'name'},{fieldPath:'shopState'}]},
    where:{fieldFilter:{field:{fieldPath:'shopState'},op:'IN',value:{arrayValue:{values:states.map(stringValue=>({stringValue}))}}}}};
  const response = await fetch(documents+':runQuery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:query}),cache:'no-store'});
  if (!response.ok) throw new Error('Inventory unavailable');
  return (await response.json()).filter(row=>row.document).map(row=>stoneFromDoc(row.document));
}

export async function readStock() {
  try {
    return await queryStock();
  } catch (error) {
    const stock = [];
    let token = '';
    do {
      const params = new URLSearchParams({pageSize:'300'});
      for (const field of ['name','shopState']) params.append('mask.fieldPaths',field);
      if (token) params.set('pageToken',token);
      const response = await fetch(documents+'/'+collection+'?'+params,{cache:'no-store'});
      if (!response.ok) throw error;
      const page = await response.json();
      for (const doc of page.documents || []) {
        const stone = stoneFromDoc(doc);
        if (states.includes(stone.state)) stock.push(stone);
      }
      token = page.nextPageToken;
    } while (token);
    return stock;
  }
}
