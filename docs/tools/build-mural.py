"""Sample the user-supplied original mural into a flat point field.
No image redraw, generated sculpture, depth estimation or relief mesh is used.
The image colors remain attached to each point during scattering/reassembly.
Requires numpy and Pillow. Seeded jitter makes the sampling reproducible.
"""
from pathlib import Path
import json, hashlib
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];A=ROOT/'assets'
rgba=np.asarray(Image.open(A/'reference.png').convert('RGB'))
h,w=rgba.shape[:2];side=512;count=side**2
rng=np.random.default_rng(20261012)
yy,xx=np.mgrid[:side,:side]
u=(xx.ravel()+.5+rng.uniform(-.35,.35,count))/side
v=(yy.ravel()+.5+rng.uniform(-.35,.35,count))/side
height=3.2;width=height*w/h
positions=np.column_stack([(u-.5)*width,(.5-v)*height,np.zeros(count)]).astype('<f4')
normals=np.zeros_like(positions);normals[:,2]=1
colors=rgba[np.clip((v*h).astype(int),0,h-1),np.clip((u*w).astype(int),0,w-1)]
lum=np.clip(colors@np.array([.2126,.7152,.0722]),0,255).astype(np.uint8)
(A/'mural.samples.bin').write_bytes(positions.tobytes()+normals.tobytes())
(A/'mural.colors.bin').write_bytes(colors.tobytes())
(A/'mural.tones.bin').write_bytes(lum.tobytes())
report={'kind':'original mural point field','depthIsApproximate':False,'geometry':'flat XY plane, Z=0; no relief','source':'User-supplied 敦煌飞天舞韵.png, not redrawn','sourceSha256':hashlib.sha256((A/'reference.png').read_bytes()).hexdigest(),'sourceResolution':[w,h],'particles':count,'particleGrid':[side,side],'physicalSize':[width,height],'sampling':{'method':'seeded stratified image sampling','seed':20261012},'coordinateSystem':'Y up, facing +Z','colorFormat':'RGB Uint8, sRGB, one color per particle'}
(A/'model-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
