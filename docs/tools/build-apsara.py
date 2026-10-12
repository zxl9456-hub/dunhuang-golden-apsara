"""Bake the Hyper3D original-color surface and its movable particles for the web.
Requires numpy, scipy and Pillow. Input: assets/apsara-web.glb (uncompressed glTF).
"""
from pathlib import Path
import hashlib, io, json, struct
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

A = Path(__file__).resolve().parents[1] / 'assets'
raw = (A/'apsara-web.glb').read_bytes()
length, kind = struct.unpack_from('<II', raw, 12)
doc = json.loads(raw[20:20+length])
offset = 20+length
bin_length, bin_kind = struct.unpack_from('<II', raw, offset)
binary = raw[offset+8:offset+8+bin_length]
def accessor(index):
    a = doc['accessors'][index]; v = doc['bufferViews'][a['bufferView']]
    dtype = {5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
    width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    start = v.get('byteOffset',0)+a.get('byteOffset',0)
    assert not v.get('byteStride'), 'Expected tightly packed exported accessors'
    return np.frombuffer(binary,dtype=dtype,count=a['count']*width,offset=start).reshape(-1,width).copy()
assert len(doc['nodes']) == 1 and not any(k in doc['nodes'][0] for k in ['matrix','rotation','scale','translation'])
p = doc['meshes'][0]['primitives'][0]
positions = accessor(p['attributes']['POSITION'])
normals = accessor(p['attributes']['NORMAL'])
uvs = accessor(p['attributes']['TEXCOORD_0'])
indices = accessor(p['indices']).reshape(-1,3).astype(np.uint32)
# Hyper3D's portrait faces +X. Rotate to face +Z, center and scale to 3.2 units.
positions = positions[:,[2,1,0]] * np.array([-1,1,1],dtype=np.float32)
normals = normals[:,[2,1,0]] * np.array([-1,1,1],dtype=np.float32)
positions -= (positions.min(axis=0)+positions.max(axis=0))*.5
positions *= 3.2 / np.ptp(positions[:,1])
normals /= np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-8)
triangles = positions[indices]
area = np.linalg.norm(np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]),axis=1)*.5
count = 512**2; rng = np.random.default_rng(20261012)
selected = np.searchsorted(np.cumsum(area), (np.arange(count)+rng.random(count))/count*area.sum())
r = np.sqrt(rng.random(count)); t = rng.random(count)
weights = np.column_stack([1-r,r*(1-t),r*t]).astype(np.float32)
sample_positions = np.einsum('ni,nij->nj',weights,triangles[selected])
sample_normals = np.einsum('ni,nij->nj',weights,normals[indices[selected]])
sample_normals /= np.maximum(np.linalg.norm(sample_normals,axis=1,keepdims=True),1e-8)
sample_uv = np.einsum('ni,nij->nj',weights,uvs[indices[selected]])
material = doc['materials'][p['material']]
texture_index = material.get('emissiveTexture',material['pbrMetallicRoughness'].get('baseColorTexture'))['index']
image = doc['images'][doc['textures'][texture_index]['source']]
view = doc['bufferViews'][image['bufferView']]
texture = binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
assert image['mimeType'] == 'image/png'
(A/'apsara-color.png').write_bytes(texture)
pixels = np.asarray(Image.open(io.BytesIO(texture)).convert('RGB')).astype(np.float32)
h,w = pixels.shape[:2]
x = np.clip(sample_uv[:,0]*w-.5,0,w-1); y = np.clip(sample_uv[:,1]*h-.5,0,h-1)
x0=x.astype(int); y0=y.astype(int); x1=np.minimum(x0+1,w-1); y1=np.minimum(y0+1,h-1)
fx=(x-x0)[:,None]; fy=(y-y0)[:,None]
colors=np.clip(np.rint((pixels[y0,x0]*(1-fx)+pixels[y0,x1]*fx)*(1-fy)+(pixels[y1,x0]*(1-fx)+pixels[y1,x1]*fx)*fy),0,255).astype(np.uint8)
tones=np.clip(colors@np.array([.2126,.7152,.0722]),0,255).astype(np.uint8)
nearest = cKDTree(sample_positions).query(positions,workers=-1)[1]
lookup=np.column_stack([(nearest%512+.5)/512,(nearest//512+.5)/512]).astype('<f4')
mesh=np.concatenate([positions.ravel(),normals.ravel(),uvs.ravel(),lookup.ravel()]).astype('<f4')
(A/'apsara.mesh.bin').write_bytes(mesh.tobytes()+indices.astype('<u4').tobytes())
meta={'vertexCount':len(positions),'indexCount':indices.size,'texture':'assets/apsara-color.png','layout':'Float32LE: XYZ positions, XYZ normals, UV, particle lookup UV; then Uint32LE indices','front':'+Z','colorSpace':'sRGB','flipY':False,'damageThreshold':.25}
(A/'apsara.mesh.json').write_text(json.dumps(meta,indent=2))
(A/'apsara.samples.bin').write_bytes(sample_positions.astype('<f4').tobytes()+sample_normals.astype('<f4').tobytes())
(A/'apsara.colors.bin').write_bytes(colors.tobytes())
(A/'apsara.tones.bin').write_bytes(tones.tobytes())
report={'kind':'Hyper3D textured 3D mesh with surface particles','sourceModel':'敦煌飞天_原画色彩.glb','sourceSha256':'848558dfb172df60babf1eba6c98192a33f894ea8a25c938a052ae030d81c777','generationId':'ddb2fa9b-f1a4-4bde-848f-45b8dabc07de','webModelSha256':hashlib.sha256(raw).hexdigest(),'triangles':len(indices),'vertices':len(positions),'particles':count,'bounds':[positions.min(axis=0).tolist(),positions.max(axis=0).tolist()],'textureResolution':[w,h],'sampling':{'method':'seeded area-weighted barycentric surface sampling','seed':20261012},'coordinateSystem':'Y up, facing +Z','sourceRotationYDegrees':-90,'originalColor':'Hyper3D shaded emissive texture preserved','rigged':False}
(A/'model-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
assert np.isfinite(mesh).all() and np.isfinite(sample_positions).all()
assert indices.max()<len(positions) and np.ptp(sample_positions[:,2])>.1
print(json.dumps(report,ensure_ascii=False))
