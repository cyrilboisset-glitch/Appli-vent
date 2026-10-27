# Vent et températures

Météo de parcours vélo. J'importe le GPX de la sortie, je donne l'heure de départ et
mon poids + ma FTP (ou simplement ma vitesse moyenne), et l'appli me dit :

- **dans quel sens faire la boucle pour avoir le vent dans le dos en fin de parcours** :
  vent moyen dans l'axe de la route sur le dernier tiers, dans les deux sens, à l'heure où
  j'y passerai (si les deux se valent, on départage sur l'ensemble). Carte colorée selon le
  vent, et téléchargement du GPX dans le bon sens ;
- **les températures mini et maxi prévues au passage**, avec le km, l'altitude et l'heure,
  sur un profil altitude + température + ressenti à vélo (refroidissement éolien avec la
  vitesse du vélo et le vent de face) ;
- **comment s'habiller** : tenue de base, couches à ajouter pour le moment le plus froid, pluie.

## Utilisation

Ouvrir **[index.html](index.html)** : un seul fichier, sans installation, à copier sur le
téléphone ou à publier avec GitHub Pages. Connexion nécessaire pour les prévisions.

## Comment ça marche

- Prévisions [Open-Meteo](https://open-meteo.com/) (gratuit, sans clé, jusqu'à 16 jours),
  demandées à l'altitude de chaque point du GPX : Open-Meteo corrige la température du modèle
  pour cette altitude (un col est plus froid que la vallée).
- Heures de passage, **mode puissance** (par défaut) : modèle physique portion par portion
  (tous les 100 m environ) avec la masse cycliste + vélo, la puissance (un % de la FTP sur le
  plat, jusqu'à +30 % dans les montées, roue libre dans les descentes, 50 km/h maxi), la pente,
  la traînée (CdA selon le vélo et le gabarit), le roulement, **le vent prévu** à l'heure du
  passage et la densité de l'air (altitude, température), plus les pauses. L'heure d'arrivée
  dépend donc aussi du sens de la boucle.
- **Mode vitesse moyenne** : la vitesse est respectée sur l'ensemble, mais 100 m de D+ comptent
  comme 1 km de plat et 100 m de D− font gagner 0,5 km.
- Le CdA (traînée) se règle dans « Réglages fins » ; pour le caler : puissance moyenne et vitesse
  d'une sortie plate. Vérification sur une vraie sortie vallonnée (38 km, 590 m D+, capteur de
  puissance) : avec le CdA calé sur une sortie plate du même cycliste, le modèle annonce 1 h 41 pour 1 h 48 réelles
  (environ 7 % trop optimiste). Pour la montée de 7,4 km, il annonce 34 min pour 37 réelles, quand
  l'ancienne règle donnait 27 min (alors qu'elle connaissait déjà la durée totale).

## Développement

```
app/src/   moteur : gpx.js (lecture/écriture), geo.js (distances, caps, horaires),
           openmeteo.js (requête, interpolation), analyse.js (vent, ressenti, tenue, temps),
           power.js (modèle de puissance)
app/       interface (index.html, app.js, style.css), sans dépendance
test/      tests du moteur
```

```
npm test          # Node ≥ 20
npm run build     # régénère index.html (fichier unique) à partir de app/
```

Pendant le développement, `app/index.html` s'ouvre aussi via un petit serveur local
(modules JavaScript), par exemple `npx serve app`.
