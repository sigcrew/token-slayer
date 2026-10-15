# 12칸 용사 팩(packs/*.json) → 48칸 고해상도(hd) 그림을 만들어 같은 파일에 넣는다.
#   python3 scripts/make-hd.py [용사id ...]     (그 뒤 node scripts/build-packs.js)
#  1) Scale2x를 두 번 적용해 계단을 부드럽게 (12→24→48)
#  2) 굵어진 외곽선을 2칸 두께로 얇게
#  3) 안쪽 면에 하이라이트(위·왼쪽)와 그림자(아래·오른쪽) 한 칸씩
#  4) 얼굴(눈 · 입 · 장식)을 고해상도로 새로 그림
import json, glob, os, sys, copy
from collections import deque
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
INK='#171522'; BODY='#FFF1DC'; SHADE='#F3CFA6'; CHEEK='#FF9DA7'
RES=int(os.environ.get('HD_RES','24'))   # 24 = 도트 느낌이 남는 고해상도(기본) · 48 = 아주 섬세

def hx(h):
    n=int(h[1:],16); return [(n>>16)&255,(n>>8)&255,n&255]
def tohex(r,g,b): return '#%02x%02x%02x'%(max(0,min(255,round(r))),max(0,min(255,round(g))),max(0,min(255,round(b))))
def light(h,f): r,g,b=hx(h); return tohex(r+(255-r)*f,g+(255-g)*f,b+(255-b)*f)
def dark(h,f): r,g,b=hx(h); return tohex(r*(1-f),g*(1-f),b*(1-f))

def scale2x(g):
    n=len(g); out=[['.']*(n*2) for _ in range(n*2)]
    def at(x,y):
        x=min(max(x,0),n-1); y=min(max(y,0),n-1); return g[y][x]
    for y in range(n):
        for x in range(n):
            P=g[y][x]; A=at(x,y-1); B=at(x+1,y); C=at(x-1,y); D=at(x,y+1)
            p1=p2=p3=p4=P
            if C==A and C!=D and A!=B: p1=A
            if A==B and A!=C and B!=D: p2=B
            if D==C and D!=B and C!=A: p3=C
            if B==D and B!=A and D!=C: p4=D
            out[2*y][2*x]=p1; out[2*y][2*x+1]=p2; out[2*y+1][2*x]=p3; out[2*y+1][2*x+1]=p4
    return out

def thin_outline(g):
    n=len(g)
    def bfs(is_src):
        dist=[[99]*n for _ in range(n)]; q=deque()
        for y in range(n):
            for x in range(n):
                if is_src(g[y][x]): dist[y][x]=0; q.append((x,y))
        while q:
            x,y=q.popleft()
            for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx,ny=x+dx,y+dy
                if 0<=nx<n and 0<=ny<n and dist[ny][nx]>dist[y][x]+1:
                    dist[ny][nx]=dist[y][x]+1; q.append((nx,ny))
        return dist
    # 화면 밖은 빈칸으로 본다: 테두리에 닿은 'o'도 바깥 외곽선으로 취급
    de=bfs(lambda c:c=='.')
    df=bfs(lambda c:c not in ('.','o'))
    nearest=[[None]*n for _ in range(n)]
    # 가장 가까운 채움색 찾기(8방향 반경 3 안)
    out=[row[:] for row in g]
    for y in range(n):
        for x in range(n):
            if g[y][x]!='o': continue
            ext = de[y][x] <= 4 and not any(0<=x+dx<n and 0<=y+dy<n and False for dx,dy in ((0,0),))
            if de[y][x]<=2: continue                       # 바깥 두 겹은 유지
            if de[y][x]<=4 and df[y][x]>=3: continue       # 바깥 선 두께 4 안쪽은 아래에서 판단
            if df[y][x]==2: continue                       # 안쪽 선의 가운데 두 겹 유지
            # 나머지: 가장 가까운 채움색으로 덮기
            best=None;bd=99
            for r in range(1,4):
                for dy in range(-r,r+1):
                    for dx in range(-r,r+1):
                        nx,ny=x+dx,y+dy
                        if 0<=nx<n and 0<=ny<n and g[ny][nx] not in ('.','o'):
                            d=abs(dx)+abs(dy)
                            if d<bd: bd=d;best=g[ny][nx]
                if best: break
            if best: out[y][x]=best
    return out


def thin24(g):
    """24칸용: 두께 2짜리 선을 1칸으로. 바깥 선은 바깥 한 겹만, 안쪽 선은 위·왼쪽 한 겹만 남긴다."""
    n=len(g)
    dist=[[99]*n for _ in range(n)]; q=deque()
    for y in range(n):
        for x in range(n):
            if g[y][x]=='.': dist[y][x]=0; q.append((x,y))
    while q:
        x,y=q.popleft()
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx,ny=x+dx,y+dy
            if 0<=nx<n and 0<=ny<n and dist[ny][nx]>dist[y][x]+1: dist[ny][nx]=dist[y][x]+1; q.append((nx,ny))
    def at(x,y): return g[y][x] if 0<=x<n and 0<=y<n else '.'
    fill=lambda c:c not in ('.','o')
    out=[row[:] for row in g]
    for y in range(n):
        for x in range(n):
            if g[y][x]!='o' or dist[y][x]<=1: continue
            if dist[y][x]==2 and any(at(x+dx,y+dy)=='.' for dx in (-1,0,1) for dy in (-1,0,1)): continue
            up,lf,dn,rt=at(x,y-1),at(x-1,y),at(x,y+1),at(x+1,y)
            if fill(dn) and up=='o': out[y][x]=dn
            elif fill(rt) and lf=='o': out[y][x]=rt
    return out

class PalAlloc:
    def __init__(self): self.i=0; self.map={}
    def new(self):
        ch=chr(0x00C0+self.i); self.i+=1
        if 0x0108<=ord(ch)<=0x010B: self.i+=4; ch=chr(0x00C0+self.i); self.i+=1
        return ch

def shade(g,pal,alloc,outpal):
    n=len(g); out=[row[:] for row in g]
    hi={};lo={}
    DYN={'c':('ĉ','ċ'),'C':('Ĉ','Ċ')}
    def keys(ch):
        if ch in DYN: return DYN[ch]
        if ch not in pal or ch in ('w','s'): return (None,None)
        if ch not in hi:
            hi[ch]=alloc.new(); lo[ch]=alloc.new()
            outpal[hi[ch]]=light(pal[ch],0.28); outpal[lo[ch]]=dark(pal[ch],0.14)
        return (hi[ch],lo[ch])
    def solid_edge(x,y):
        if not(0<=x<n and 0<=y<n): return True
        return g[y][x] in ('.','o')
    for y in range(n):
        for x in range(n):
            ch=g[y][x]
            if ch in ('.','o'): continue
            h,l=keys(ch)
            if h is None: continue
            up=solid_edge(x,y-1); lf=solid_edge(x-1,y); dn=solid_edge(x,y+1); rt=solid_edge(x+1,y)
            if (up or lf) and not (dn or rt): out[y][x]=h
            elif (dn or rt) and not (up or lf): out[y][x]=l
    return out

def eye_cells(x0,y0,w=4,h=6,col='o',hl=True):
    cells=[]
    for dy in range(h):
        for dx in range(w):
            if dy in (0,h-1) and dx in (0,w-1): continue
            cells.append([x0+dx,y0+dy,col])
    if hl: cells += [[x0+1,y0+1,'W'],[x0+1,y0+2,'W']]
    return cells

def face_set(style, ecol=None, mcol=None):
    EX=(24,36); EY=29
    eo = ecol or 'o'; mo = mcol or 'o'
    st=style
    def open_eyes(col=eo):
        if st.get('visor'):
            v=st['visor']
            return [[x,y,v] for x in range(12,44) for y in (28,29,30)]+[[x,y,'V'] for x in range(12,44) for y in (31,32)]+[[18,28,'W'],[19,28,'W'],[20,28,'W']]
        if st.get('eyes')=='slant':
            c=[]
            for i in range(5): c.append([EX[0]+i,EY+4-i//2*1 if False else EY+3-i//2,'o'])
            for i in range(5): c.append([EX[1]-1+i,EY+1+i//2+0,'o'])
            return c
        if st.get('eyes')=='closed': return closed()
        return eye_cells(EX[0],EY,col=col)+eye_cells(EX[1],EY,col=col)
    def closed(col='o'):
        out=[]
        for ex in EX:
            out += [[ex,EY+4,col],[ex+1,EY+5,col],[ex+2,EY+5,col],[ex+3,EY+4,col]]
        return out
    def xeyes():
        out=[]
        for ex in EX:
            for i in range(5): out += [[ex-1+i,EY+i,'o'],[ex+3-i,EY+i,'o']]
        return out
    def happy():
        out=[]
        for ex in EX: out += [[ex,EY+4,'o'],[ex+1,EY+3,'o'],[ex+2,EY+3,'o'],[ex+3,EY+4,'o']]
        return out
    def tired():
        out=[]
        for ex in EX: out += [[ex+i,EY+3,'o'] for i in range(4)]+[[ex+1,EY+4,'o'],[ex+2,EY+4,'o']]
        return out
    cheeks=[] if st.get('cheeks') is False else [[17,34,'H'],[18,34,'H'],[19,34,'H'],[17,35,'H'],[18,35,'H'],[41,34,'H'],[42,34,'H'],[43,34,'H'],[42,35,'H'],[43,35,'H']]
    def mouth(kind='smile'):
        if st.get('nomouth'): return []
        m=mo
        if st.get('mouth')=='mustache' and kind!='hit':
            return [[27,38,'o'],[28,38,'o'],[29,38,'o'],[30,39,'o'],[31,38,'o'],[32,38,'o'],[33,39,'o'],[34,38,'o'],[35,38,'o'],[26,39,'o'],[36,39,'o'],[31,37,'o'],[32,37,'o']]
        if kind=='hit': return [[30,38,m],[31,38,m],[32,38,m],[33,38,m]]
        if kind=='tired': return [[30,38,'T'],[31,38,'T'],[32,38,'T'],[33,38,'T']]
        base=[[29,37,m],[30,38,m],[31,38,m],[32,38,m],[33,38,m],[34,37,m]]
        if st.get('mouth')=='fang' and kind in ('fight','happy'): base+= [[30,39,'W'],[33,39,'W']]
        return base
    def brows():
        return [[EX[0]-1+i,EY-3+(0 if i>1 else 0)+ (1 if i<2 else 0) ,'o'] for i in range(5)]+[[EX[1]-1+i,EY-3+(1 if i>2 else 0),'o'] for i in range(5)] if st.get('brows')=='angry' else []
    deco=[]
    if st.get('scar'): deco += [[17,28,'R'],[17,29,'R'],[18,30,'R'],[18,31,'R'],[19,32,'R'],[19,33,'R']]
    if st.get('warpaint'): deco += [[41,28,'R'],[42,28,'R'],[41,29,'R'],[42,29,'R'],[41,34,'R'],[42,34,'R']]
    out={}
    def eyepatch(cells):
        if not st.get('eyepatch'): return cells
        cells=[c for c in cells if not (c[0]<=29 and c[2]!='W') ] if False else [c for c in cells if c[0]>=33]
        patch=[[x,y,'o'] for x in range(22,30) for y in range(28,36) if not ((x in (22,29)) and (y in (28,35)))]
        return cells+patch+[[x,y,'o'] for x,y in [(14,26),(15,26),(16,26),(17,27),(18,27),(19,27),(20,28),(21,28)]]
    full=lambda eyes,kind,mc=None: eyepatch(eyes)+mouth(kind)+cheeks+deco+(brows() if (st.get('brows') and kind in ('fight','happy')) else [])
    out['fight']=full(open_eyes(),'fight')
    out['rest']=full(closed(eo if st.get('colorAlways') else 'o'),'rest')
    out['hit']=full(xeyes(),'hit')
    out['happy']=full(happy(),'happy')
    out['tired']=full(tired(),'tired')
    out['blink']=full(closed('o'),'blink')
    if st.get('visor'):
        for k in ('rest','hit','tired','blink'):
            out[k]=[c for c in out[k] if c[2] not in ('V',)]
    return out


def face_set24(st, ecol=None, mcol=None):
    """24칸 얼굴: 눈 2x3 · 입 4칸. 선택 장식(안대 · 바이저 · 흉터 …)도 같이 그린다."""
    EX=(12,18); EY=14
    eo=ecol or 'o'; mo=mcol or 'o'
    def eyes_open(col=eo):
        if st.get('visor'):
            v=st['visor']
            return [[x,y,v] for x in range(6,22) for y in (14,15)]+[[x,16,'V'] for x in range(6,22)]+[[9,14,'W']]
        if st.get('eyes')=='slant': return [[12,EY,'o'],[13,EY+1,'o'],[18,EY+1,'o'],[19,EY,'o']]
        if st.get('eyes')=='closed': return closed()
        c=[]
        for ex in EX: c+=[[ex,EY,col],[ex+1,EY,col],[ex,EY+1,col],[ex+1,EY+1,col],[ex,EY+2,col],[ex+1,EY+2,col],[ex,EY,'W']]
        return c
    def closed(col='o'): return [[ex+i,EY+2,col] for ex in EX for i in (0,1)]
    def xeyes(): return [[ex+dx,EY+dy,'o'] for ex in EX for dx,dy in ((0,0),(2,0),(1,1),(0,2),(2,2))]
    def happy(): return [[ex,EY+2,'o'] for ex in EX]+[[ex+1,EY+1,'o'] for ex in EX]+[[ex+2,EY+2,'o'] for ex in EX]
    def tired(): return [[ex+i,EY+1,'o'] for ex in EX for i in (0,1)]+[[ex,EY+2,'o'] for ex in EX]
    cheeks=[] if st.get('cheeks') is False else [[8,17,'H'],[9,17,'H'],[20,17,'H'],[21,17,'H']]
    def mouth(kind):
        if st.get('nomouth'): return []
        if st.get('mouth')=='mustache' and kind!='hit': return [[13,19,'o'],[14,19,'o'],[15,18,'o'],[16,18,'o'],[17,19,'o'],[18,19,'o']]
        if kind=='hit': return [[15,19,mo],[16,19,mo]]
        if kind=='tired': return [[15,19,'T'],[16,19,'T']]
        m=[[14,18,mo],[15,19,mo],[16,19,mo],[17,18,mo]]
        if st.get('mouth')=='fang' and kind in ('fight','happy'): m+=[[14,19,'W'],[17,19,'W']]
        return m
    brows=[[11,EY-2,'o'],[12,EY-1,'o'],[20,EY-2,'o'],[19,EY-1,'o']] if st.get('brows')=='angry' else []
    deco=[]
    if st.get('scar'): deco+=[[8,13,'R'],[8,14,'R'],[9,15,'R'],[9,16,'R']]
    if st.get('warpaint'): deco+=[[20,14,'R'],[21,14,'R'],[20,17,'R']]
    def patch(c):
        if not st.get('eyepatch'): return c
        c=[x for x in c if x[0]>=16]
        return c+[[x,y,'o'] for x in range(10,15) for y in range(13,17)]+[[7,12,'o'],[8,12,'o'],[9,12,'o'],[10,13,'o']]
    full=lambda eyes,kind: patch(eyes)+mouth(kind)+cheeks+deco+(brows if kind in ('fight','happy') else [])
    out={'fight':full(eyes_open(),'fight'),'rest':full(closed(eo if st.get('colorAlways') else 'o'),'rest'),'hit':full(xeyes(),'hit'),'happy':full(happy(),'happy'),'tired':full(tired(),'tired'),'blink':full(closed('o'),'blink')}
    return out

def build_hd(pack):
    grid=pack['grid']
    pal={'o':INK,'w':BODY,'s':SHADE}; pal.update(pack.get('palette',{}))
    g=[list(r) for r in grid]
    if RES==48:
        g=thin_outline(scale2x(scale2x(g)))
    else:
        g=thin24(scale2x(g))
    alloc=PalAlloc(); outpal={}
    g=shade(g,pal,alloc,outpal)
    fc=pack.get('face') or {}
    style=dict(fc)
    style['nomouth']=bool(pack.get('faceNoMouth'))
    ecol=None;mcol=None
    # 눈 · 입 색: 팩 팔레트 확장 키
    fk={}
    if fc.get('eyeColor'): ecol=alloc.new(); outpal[ecol]=fc['eyeColor']
    if fc.get('mouthColor'): mcol=alloc.new(); outpal[mcol]=fc['mouthColor']
    faces=(face_set24 if RES==24 else face_set)(style,ecol,mcol)
    outpal.update({'W':'#FFFFFF','H':CHEEK,'T':'#FF6F86','R':'#B03A2E','V':'#0E7A8A'})
    if fc.get('visor'): outpal['V']=dark(fc['visor']['color'],0.55) if isinstance(fc['visor'],dict) else '#0E7A8A'
    if isinstance(fc.get('visor'),dict): style['visor']=fc['visor']['color']
    # visor 색을 키로
    if fc.get('visor'):
        vk=alloc.new(); outpal[vk]=fc['visor']['color']
        faces=(face_set24 if RES==24 else face_set)({**style,'visor':vk},ecol,mcol)
    hd={'grid':[''.join(r) for r in g],'faces':faces,'palette':outpal}
    return hd

if __name__=='__main__':
    only=sys.argv[1:] 
    for f in sorted(glob.glob(ROOT+'/packs/*.json')):
        d=json.load(open(f,encoding='utf8'))
        if d['type']!='hero' or d.get('hires'): continue
        if only and d['id'] not in only: continue
        d['hd']=build_hd(d)
        json.dump(d,open(f,'w',encoding='utf8'),ensure_ascii=False,indent=1)
        print('built',d['id'])
