# Vent et températures

Météo de parcours vélo. J'importe le GPX de la sortie, je donne l'heure de départ et ma
vitesse moyenne, et l'appli me dit :

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
- Heures de passage estimées : la vitesse moyenne est respectée sur l'ensemble, mais 100 m de
  D+ comptent comme 1 km de plat et 100 m de D− font gagner 0,5 km.
- Vent prévu à 10 m du sol ; pour le ressenti, 70 % de ce vent atteint le cycliste.

## Développement

```
app/src/   moteur : gpx.js (lecture/écriture), geo.js (distances, caps, horaires),
           openmeteo.js (requête, interpolation), analyse.js (vent, ressenti, tenue)
app/       interface (index.html, app.js, style.css), sans dépendance
test/      tests du moteur
```

```
npm test          # Node ≥ 20
npm run build     # régénère index.html (fichier unique) à partir de app/
```

Pendant le développement, `app/index.html` s'ouvre aussi via un petit serveur local
(modules JavaScript), par exemple `npx serve app`.
