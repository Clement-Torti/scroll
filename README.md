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
