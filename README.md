# Shorts FR

Feed vertical estilo TikTok construido sobre el reproductor de YouTube, con
**contenido exclusivamente en francés** y descubrimiento automático (nada de
listas estáticas). Un solo archivo `index.html`, sin dependencias ni build:
se despliega tal cual en GitHub Pages.

---

## Despliegue en GitHub Pages

```bash
git init && git add index.html README.md
git commit -m "Shorts FR"
git branch -M main
git remote add origin git@github.com:<usuario>/<repo>.git
git push -u origin main
```

Luego en GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
Queda publicado en `https://<usuario>.github.io/<repo>/`.

Para probar en local (el reproductor de YouTube necesita `http://`, no `file://`):

```bash
python3 -m http.server 8080   # → http://localhost:8080
```

## Clave de API

La app pide una clave de **YouTube Data API v3** en el primer arranque y la
guarda en el `localStorage` del navegador. No hay servidor: la clave nunca sale
del navegador salvo hacia `googleapis.com`.

1. [Crea un proyecto](https://console.cloud.google.com/projectcreate) en Google Cloud.
2. Activa [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
3. [Credenciales](https://console.cloud.google.com/apis/credentials) → *Crear* → *Clave de API*.
4. **Restríngela**, porque la página es pública:
   - *Restricciones de aplicación* → **Sitios web** → `https://<usuario>.github.io/*`
   - *Restricciones de API* → solo **YouTube Data API v3**

Con eso, aunque alguien lea la clave en el `localStorage` de su propio
navegador, solo puede usarla desde tu dominio y contra esa única API.

---

## Cómo se garantiza que el contenido es francés

**YouTube no lo garantiza.** `relevanceLanguage=fr` es solo una señal de
relevancia y `snippet.defaultAudioLanguage` es un campo *opcional* que muchos
creadores no rellenan. Por eso el filtro apila cinco capas y una vídeo entra al
feed solo si el veredicto combinado supera el umbral elegido:

| Capa | Señal | Fuerza |
|---|---|---|
| **L0** | Consulta sesgada: semillas en francés + `relevanceLanguage=fr` + `regionCode=FR` | orientativa |
| **L1** | `defaultAudioLanguage` / `defaultLanguage` del vídeo | **dura** — decide sola, en positivo y en negativo |
| **L2** | Canal: `country`, `brandingSettings.defaultLanguage`, memoria local aprendida | media |
| **L3** | `LanguageDetector` del navegador (on-device, Chrome/Edge) | alta si está disponible |
| **L4** | Heurística de texto: léxico de 13 idiomas + ortografía + rechazo de escrituras no latinas | media |

Detalles que importan:

- **Rechazos duros inmediatos**: audio o metadatos declarados en otro idioma,
  escritura no latina (cirílico, árabe, CJK, devanagari…), canal ya descartado.
- **La heurística exige evidencia léxica.** Un acento aislado no basta: `è`
  solo haría pasar un título italiano por francés. El léxico francés excluye a
  propósito las palabras muy compartidas (`de`, `que`, `un`, `tu`, `il`, `ma`,
  `qui`, `y`) y cualquier palabra presente en dos idiomas se elimina de ambos.
- **Aprende por canal**: tras 3 aciertos un canal queda validado (sus vídeos
  pasan directo); tras 3 fallos queda descartado. Un simple *falta de pruebas*
  nunca condena a un canal — si no, el modo estricto acabaría eliminando
  canales franceses que rellenan mal sus metadatos.
- **Botón «Pas FR»**: el usuario descarta el canal completo de forma definitiva
  y purga sus vídeos de la cola.
- **Tres niveles de severidad** en ajustes (estricto / equilibrado / amplio).
  Al cambiarlo, los vídeos descartados por falta de pruebas vuelven a evaluarse.

Cobertura medida sobre 59 títulos reales en 16 idiomas, incluyendo casos
adversariales (francés con anglicismos, títulos de 3 palabras, catalán,
portugués frente a español): **100 %**.

## Cómo descubre contenido

`search.list` cuesta **100 unidades**; todo lo demás cuesta **1**. Con 10 000
unidades diarias eso da solo 100 búsquedas — insuficiente para un feed
infinito. La arquitectura le da la vuelta:

- La búsqueda sirve para **descubrir canales**, no solo vídeos. Cada canal
  validado entra en un *pool* persistente.
- Las recargas siguientes tiran de la playlist «uploads» de esos canales:
  **1 unidad por 50 vídeos**, 100× más barato.
- El ranking `mostPopular` de Francia (1 u) aporta novedad.
- Los canales seguidos alimentan su pestaña e inyectan vídeos en «Pour toi».

Encima va un modelo de intereses (términos, categorías y canales ponderados a
partir de tus «me gusta») con estrategia ε-greedy: ~55 % explotación de tus
intereses, ~45 % exploración de semillas nuevas, con rotación de `order` y de
ventana temporal para que dos sesiones nunca den el mismo feed.

Garde-fous de cuota, por recarga: presupuesto máximo de una búsqueda + 60
unidades, una sola búsqueda por recarga, parada tras 4 rondas sin resultados y
pausa de 60 s si una recarga vuelve vacía. Medido: cuando las fuentes se agotan
el coste de 8 recargas cae de 1560 u a 4 u.

## Canales favoritos

**Suivre** en cualquier vídeo añade el canal. Entonces:

- La pestaña **Abonnements** es un feed vertical con sus vídeos nuevos, del más
  reciente al más antiguo, **sin filtro de idioma ni de duración** — son los
  canales que tú elegiste.
- El badge del contador de novedades se calcula con `videoPublishedAt` de
  `playlistItems`: 1 unidad por canal, sin necesidad de `videos.list`.
- El panel **Mes chaînes** lista los canales con su contador y permite escanear
  a demanda o dejar de seguirlos.
- Seguir un canal lo marca como francés validado y lo prioriza en el pool.

## Icono en la pantalla de inicio (iOS)

Al añadir la página a la pantalla de inicio, se comporta como una app: sin
barras de Safari (`display: standalone`), orientación vertical, y un icono
propio en `icons/`. El icono es un diseño original — un triángulo de play con
la bandera francesa — generado desde [icons/icon.svg](icons/icon.svg):

```bash
for SZ in 1024 512 192 180 32; do
  magick -background "#0b0b12" icons/icon.svg -resize ${SZ}x${SZ} -flatten -alpha off -depth 8 out-${SZ}.png
done
```

Dos detalles que importan: Safari **ignora el SVG** para `apple-touch-icon`
(hace falta un PNG opaco de 180×180), y `black-translucent` hace que el
contenido pase por debajo de la barra de estado — de ahí los márgenes
`env(safe-area-inset-*)` en el CSS.

### Poner tu propio icono

`icons/custom-touch-icon.png` está en `.gitignore` y, si existe, gana sobre el
del repo. Para usarlo solo en local:

```bash
cp ~/mi-icono.png icons/custom-touch-icon.png   # PNG opaco, 180×180
python3 -m http.server 8080
```

Para que aparezca también en el sitio publicado hay que **servirlo**, es decir
versionarlo — quitando esa línea del `.gitignore` y comiteándolo. En ese
momento el archivo pasa a estar público y lo descarga cualquiera que visite la
página, así que es una decisión distinta de «el icono de mi teléfono»:

```bash
sed -i '' '/custom-touch-icon/d' .gitignore
git add -f icons/custom-touch-icon.png && git commit -m "icône perso" && git push
```

### La vía Atajos (icono libre, sin tocar el repo)

La app **Atajos** permite un icono arbitrario desde tu carrete, sin publicar
nada: nuevo atajo → acción *Abrir URL* → tu URL → ⓘ → *Añadir a pantalla de
inicio* → tocar la miniatura → *Elegir foto* → nombre y listo.

El coste es real: un atajo abre en Safari con un banner, no en modo
`standalone`. Pierdes la sensación de app nativa. Si quieres icono propio **y**
pantalla completa, el archivo tiene que estar servido — no hay tercera vía.

---

## Perfil en una Google Sheet (Apps Script)

La clave API sigue en `localStorage`. El **perfil** — canales descubiertos,
suscripciones, temas, intereses, «me gusta» — vive en una hoja de cálculo, así
que sobrevive al borrado del navegador y sigue a todos tus dispositivos.

La hoja **no necesita ser pública**. El script se ejecuta con tu propia
autorización (*ejecutar como: yo*), así que accede a una hoja privada sin
problema. Déjala privada.

### Puesta en marcha

**No hay nada que configurar en `Code.gs`.**

1. [script.google.com](https://script.google.com) → Nuevo proyecto → pega
   [apps-script/Code.gs](apps-script/Code.gs).
2. Ejecuta la función `setup()` una vez. Concede los permisos; el script
   **crea la hoja él mismo** («Shorts FR — profil») en tu Drive, guarda su ID
   en las propiedades del script y escribe la dirección en el registro.
3. Implementar → Nueva implementación → **Aplicación web**, ejecutar *como yo*,
   acceso *cualquier persona*. Copia la URL `.../exec`.
4. Pega esa URL en la app — ya en la pantalla de inicio, o después en Ajustes →
   Sincronización → **Connecter**. Ahí aparece un enlace directo a tu hoja.

### Usar una hoja que ya tienes

Si prefieres una hoja concreta, no hace falta escribir su ID en el archivo
(cosa poco deseable en un repo público). Se apunta una sola vez desde el editor:

```js
function go() { useSheet('1AbC…'); }   // acepta el ID o la URL entera
```

El ID queda en las propiedades del script, no en git. `forgetSheet()` deshace
el enlace y hace que el siguiente arranque cree una hoja nueva.

> **Al modificar `Code.gs` hay que volver a desplegar.** La URL `/exec` apunta a
> una **versión congelada** del script: guardar en el editor no cambia nada de
> lo que sirve esa URL. Hay que hacer *Implementar → Gestionar implementaciones
> → ✏️ → Versión: **Nueva versión** → Implementar*. La URL no cambia. Es el
> error más fácil de cometer y el más difícil de diagnosticar.

### Sin autenticación: la URL *es* la contraseña

No hay token. Google no lo pide y para un solo usuario no aporta gran cosa: la
URL `/exec` ya contiene un identificador largo e imposible de adivinar
(`/macros/s/AKfycb…/exec`). Trátala como una contraseña — no la publiques.

Lo que sí hice es quitar la única operación destructiva del alcance de esa URL:
`resetProfile()` ya **no está expuesta por HTTP** y solo se ejecuta desde el
editor de Apps Script. Así, quien conociera la URL podría leer o sobrescribir
el perfil, pero no borrar la hoja.

### Arquitectura: local-first

Un feed vertical no puede esperar 500 ms de ida y vuelta a cada «me gusta». Así
que `localStorage` sigue siendo la caché de trabajo: al arrancar se **tira** del
estado remoto y se fusiona, después se **empujan deltas** con 6 s de retardo.

Las fusiones son **uniones conmutativas** — el orden entre dispositivos no
importa — con dos excepciones deliberadas: un veredicto «no es francés» es
definitivo y gana siempre, y los ajustes vienen del remoto, que es la
referencia.

El envío es **automático**, nunca hace falta pulsar nada. Tres detalles que lo
hacen fiable:

- **Debounce acotado** (6 s, máximo 45 s). Un debounce simple se moría de
  hambre: cada slide llama a `markSeen()` y `reinforce()`, así que al hacer
  scroll continuo el temporizador se rearmaba cada 2 s y el envío no llegaba
  nunca. `MAX_WAIT` garantiza una latencia máxima.
- **Reintento a los 30 s** si falla la red. Antes un fallo esperaba a la
  siguiente modificación.
- **`navigator.sendBeacon` al salir de la página**, porque iOS puede matar un
  `fetch` al congelar la pestaña. Las escrituras son upserts idempotentes, así
  que un duplicado eventual no hace daño.

### La trampa del CORS

**Apps Script no responde a las peticiones previas de CORS (`OPTIONS`).** Por
eso el cliente envía `Content-Type: text/plain;charset=utf-8`: así la petición
sigue siendo una *simple request* y el navegador nunca lanza el preflight.
Cambiarlo a `application/json` rompería todo, y no se puede arreglar añadiendo
cabeceras en `doPost` — el preflight falla antes de que tu código se ejecute.

### Pestañas de la hoja

| Pestaña | Contenido |
|---|---|
| `kv` | ajustes, intereses, estadísticas, memoria de idioma, vistos (JSON) |
| `channels` | el pool de canales descubiertos, con su puntuación |
| `subscriptions` | tus canales seguidos |
| `topics` | categorías, temas y palabras clave elegidas |
| `liked` | tus «me gusta» |

Una celda de Sheets admite 50 000 caracteres, así que los valores grandes se
parten en trozos (`seen#0`, `seen#1`…) y se reensamblan al leer. Y las
escrituras se hacen en **un solo `setValues()`** por pestaña: celda a celda,
300 canales tardarían minutos y agotarían las cuotas de Apps Script.

La clave API de YouTube nunca se envía a la hoja — se queda en el
`localStorage` del navegador.

---

## Temas de interés configurables

Panel *Ajustes → Centros de interés*. Tres ejes, y conviene saber cuál sirve
para qué:

- **Palabras clave** (`q`): el levier más eficaz. «recette de grand-mère» da
  mejores resultados que una categoría entera.
- **Categorías** (`videoCategoryId`): las ~15 oficiales, con etiquetas en
  francés que la propia API entrega para la región FR. Exige `type=video`.
- **Temas** (`topicId`): un juego **congelado** de identificadores desde el
  final de Freebase (27-02-2017). Es toda la granularidad que existe.

El interruptor *N'utiliser que mes thèmes* decide si la selección **restringe**
la búsqueda o solo la **prioriza** dejando que la exploración siga.

Ojo con una trampa de la API: `topicDetails.topicIds` y `relevantTopicIds`
están deprecados desde el 10-11-2016 y **devuelven vacío**. Solo
`topicCategories` (URLs de Wikipedia) sigue dando datos, y no es consultable.

### Lo que la API *no* hace

**La API de YouTube no aprende tus gustos.** Con una API key las llamadas son
apátridas y anónimas: la clave identifica al proyecto, no a una persona. Y con
OAuth tampoco hay recomendaciones — `activities.list?home=true` está deprecado,
y el historial de visualización se retiró en 2016. Por eso el modelo de
intereses es nuestro, y por eso guardarlo importa.

---

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `↓` `j` / `↑` `k` | siguiente / anterior |
| `espacio` | pausa |
| `m` | sonido |
| `l` | me gusta |
| `Esc` | cerrar paneles |

Gestos: swipe vertical, un toque para pausar, doble toque para «me gusta».

## Límites conocidos

- El navegador solo permite autoplay **silenciado**; hay que tocar una vez
  «Appuie pour le son» (igual que TikTok o Instagram en web).
- Los vídeos con el embed desactivado por su autor no se pueden reproducir; se
  detectan por `status.embeddable` y por el error del reproductor, y se saltan.
- `LanguageDetector` solo existe hoy en Chrome/Edge; sin él el filtro cae a la
  heurística de texto, que es la capa más débil.
- La cuota se reinicia a medianoche del Pacífico (≈ 9 h en Francia).
- Todo el estado (clave, favoritos, intereses, memoria de idioma) es local por
  navegador: no se sincroniza entre dispositivos.
