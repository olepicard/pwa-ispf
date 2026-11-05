# lspf-pwa

Version **Android** de [node-lspf](../node-lspf/README.md), sous forme de *Progressive Web App* : le clone du Dialogue Manager ISPF (menus, liste de fichiers 3.4, éditeur avec commandes de ligne, macros REXX…) tourne entièrement dans le navigateur du téléphone. Une fois installée, l'application s'utilise hors connexion, sans serveur.

Le moteur et les applications sont ceux de node-lspf, **sans modification**. Le script de construction les reprend dans `../node-lspf` et leur fournit :

- un système de fichiers virtuel, conservé dans le stockage du navigateur (IndexedDB) ;
- un terminal dessiné sur un `<canvas>` ;
- une saisie adaptée au tactile et aux claviers virtuels.

## Installer sur un téléphone Android

Une PWA doit être servie en **HTTPS**, ou depuis `http://localhost`. Le contenu à publier est le répertoire `www/`, déjà construit. Trois possibilités :

1. **Par câble USB, pour essayer.** Il faut le débogage USB activé et `adb` installé (Android Platform Tools).
   ```sh
   node serve.js                    # http://localhost:8080
   adb reverse tcp:8080 tcp:8080    # le téléphone voit le port 8080 du PC sur son propre localhost
   ```
   Sur le téléphone, ouvrez `http://localhost:8080` dans Chrome, puis menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).
2. **Sur un serveur HTTPS** : intranet, GitHub Pages, Netlify, ou tout hébergement de fichiers statiques. Copiez le contenu de `www/` à la racine ou dans un sous-répertoire (les chemins sont relatifs), ouvrez l'adresse dans Chrome Android, puis **Installer l'application**.
3. **Sur le réseau local, sans HTTPS** : `node serve.js --host 0.0.0.0`, puis dans Chrome Android allez dans `chrome://flags`, option *Insecure origins treated as secure*, et ajoutez `http://ADRESSE-DU-PC:8080`.

Une fois installée, lspf s'ouvre en plein écran, comme une application, et fonctionne **hors connexion**. Après une nouvelle construction publiée au même endroit, la nouvelle version est prise au lancement suivant.

Pour obtenir un vrai fichier APK (Play Store, MDM), on peut emballer la PWA publiée en HTTPS avec [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (Trusted Web Activity) ; ce n'est pas nécessaire pour l'utiliser.

## Utilisation

**Écran.** Il fait au moins 80 × 24 et plus si la place le permet : environ 128 colonnes sur un téléphone en paysage. Le paysage est recommandé. La taille du texte se règle par pincement à deux doigts ou dans le menu ☰. Après une rotation, le panneau affiché garde sa mise en page jusqu'au prochain Entrée.

**Barre de touches**

| Touche | Rôle |
|---|---|
| F1 … F12 | touches PF. Elles portent vos libellés : si F4 = `MACRO SUPALL` dans `KEYS`, la touche affiche « Supall » |
| ⇧ | bascule sur F13 … F24 |
| ⌨ | ouvre le clavier du téléphone |
| Tab, ⇤, flèches, ⇱ ⇲ (Home / End), Ins, Del, ⌫, Esc | comme sur un clavier |
| EOF | efface jusqu'à la fin du champ (Ctrl-E) |
| Entrée | valide l'écran |
| ☰ | menu (voir plus bas) |

Les flèches, Tab, Del et ⌫ se répètent si on les maintient.

**Gestes sur l'écran**

| Geste | Effet |
|---|---|
| toucher | place le curseur (comme un clic, donc `MOUSE LEFT F4` fonctionne : toucher un mot lance F4). Sur `F4=…` dans les lignes de touches de l'écran : appuie sur la touche |
| double toucher | double-clic (`MOUSE DOUBLE …`) |
| appui long | Entrée à cet endroit (point-and-shoot), comme le clic droit |
| glisser horizontal | décale l'affichage à gauche ou à droite dans EDIT, VIEW et BROWSE |
| glisser vertical | fait défiler (UP / DOWN) |
| deux doigts | déplacer la vue ; pincer pour changer la taille du texte |

**Bouton Retour d'Android** : F3 (END). Sur le menu principal, F3 termine la session ; toucher l'écran la relance.

**Clavier physique** (Bluetooth, DeX, Chromebook) : F1 à F12 (Maj pour F13 à F24), Entrée, Tab, Inser, flèches, Ctrl-lettre et Alt-lettre fonctionnent comme dans node-lspf.

**Menu ☰**

- **Importer des fichiers** : copie des fichiers du téléphone dans le répertoire affiché par la liste de fichiers (3.4), ou dans `/home/lspf` ;
- **Exporter un fichier** : télécharge un fichier de lspf ;
- **Sauvegarde complète / Restaurer** : un fichier `.json` avec tous vos fichiers, profils et macros ;
- taille du texte, plein écran, ouverture du clavier à chaque toucher ;
- effacement de toutes les données.

## Fichiers

| Chemin | Contenu |
|---|---|
| `/home/lspf` | vos fichiers (répertoire courant, `~`). Au premier lancement, il contient `LISEZMOI.txt` et `exemples/` (COBOL, JCL, fichier à lignes longues) |
| `/home/lspf/.lspf-node` | profils, tables, journaux, et `rexx/` pour vos macros d'édition |
| `/lspf` | bibliothèques de node-lspf en lecture seule (`plib`, `mlib`, `help`, `rexx` avec EXMACRO, SUPALL, SUPFIND, SUPRES) |

Les noms de fichiers **ne tiennent pas compte de la casse**, comme sous Windows : la ligne de commande ISPF est en majuscules, donc `ED ~/EXEMPLES/PROG01.CBL` ouvre `~/exemples/PROG01.cbl`. La casse d'origine est conservée.

Les données restent dans le navigateur du téléphone. Elles disparaissent si l'on désinstalle l'application ou efface les données du site : faites des sauvegardes (menu ☰).

**Limite** : les commandes système (option 6, `TSO`, `SHELL`, `ADDRESS SYSTEM` dans une macro) ne sont pas disponibles dans un navigateur. Elles renvoient le code 127 avec un message.

## Construire et tester

Il faut Node.js 20 ou plus. Aucune dépendance npm.

```sh
node build.js            # construit www/ à partir de ../node-lspf (--src DIR pour un autre emplacement)
node serve.js            # sert www/ sur http://localhost:8080
node test/run-node.js    # le bundle exécuté dans un contexte isolé (sans modules Node)
node test/e2e-chrome.js  # test de bout en bout dans Chrome/Edge sans interface : téléphone Android émulé,
                         #   gestes tactiles, clavier virtuel, installabilité, hors connexion, persistance
                         #   (--shots DIR pour garder des captures d'écran)
```

Après une modification de node-lspf, il suffit de relancer `node build.js` : le bundle reprend `lib/`, `apps/` et les bibliothèques.

## Structure

```
build.js             construit www/ : bundle, icônes PNG (générées), service worker versionné
serve.js             serveur statique de test (gzip, types MIME, manifest)
public/              index.html, app.css, manifest.webmanifest
src/main.js          démarrage, cycle de vie de la session, barre de touches, menu, import / export / sauvegarde
src/webterm.js       terminal canvas (même interface que lib/terminal.js de node-lspf) et gestes tactiles
src/input.js         clavier physique (keydown) et clavier virtuel Android (textarea + différences)
src/vfs.js           système de fichiers virtuel synchrone, persistance IndexedDB
src/shims/           fs, path, os, events, process, child_process pour le navigateur
src/loader.js        chargeur de modules CommonJS du bundle
src-sw/sw.js         service worker (cache hors connexion)
test/                tests (Node isolé, Chrome sans interface)
www/                 résultat de la construction : le répertoire à publier
```

Licence : GPL v3, comme lspf et node-lspf.
