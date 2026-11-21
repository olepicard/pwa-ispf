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

Ces étapes sont aussi affichées dans l'application : au premier lancement dans un onglet du navigateur (case « Ne plus afficher au démarrage »), et à tout moment par le menu ☰ → **Installer l'application**. Quand Chrome le propose, un bouton **Installer maintenant** lance directement l'installation.

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
| toucher | équivaut à un clic : place le curseur (donc `MOUSE LEFT F4` fonctionne : toucher un mot lance F4). Sur `F4=…` dans les lignes de touches de l'écran : appuie sur la touche. Sur un champ point-and-shoot : Entrée à cet endroit |
| toucher un nom dans la liste 3.4 | `V` sur l'entrée : VIEW du fichier, liste du répertoire (`..` remonte), visualiseur pour un fichier XMIT, analyseur pour un dump z/OS |
| toucher un en-tête de colonne de la liste 3.4 | tri descendant sur cette colonne ; un second toucher inverse l'ordre |
| double toucher | double-clic (`MOUSE DOUBLE …`) |
| appui long | Entrée à cet endroit (point-and-shoot), comme le clic droit |
| glisser horizontal | décale l'affichage à gauche ou à droite dans EDIT, VIEW et BROWSE |
| glisser vertical | fait défiler (UP / DOWN) |
| deux doigts qui glissent | déplacer la vue |
| deux doigts qui s'écartent / se rapprochent | zoom avant / arrière. L'écran suit les doigts pendant le geste ; la nouvelle taille de texte est appliquée quand on les relève (de 50 % à 300 %), le point pincé reste sous les doigts, et un message indique la taille et le nombre de lignes et colonnes. En zoom avant, l'écran 80 × 24 dépasse : on le déplace à deux doigts. En zoom arrière, l'écran gagne des colonnes |

**Bouton Retour d'Android** : F3 (END). Sur le menu principal, F3 termine la session ; toucher l'écran la relance.

**Clavier physique** (Bluetooth, DeX, Chromebook) : F1 à F12 (Maj pour F13 à F24), Entrée, Tab, Inser, flèches, Ctrl-lettre et Alt-lettre fonctionnent comme dans node-lspf.

**Menu ☰**

- **Importer des fichiers** : copie des fichiers du téléphone dans le répertoire affiché par la liste de fichiers (3.4), ou dans `/home/lspf` ;
- **Exporter un fichier** : télécharge un fichier de lspf ;
- **Sauvegarde complète / Restaurer** : un fichier `.json` avec tous vos fichiers, profils et macros ;
- taille du texte, plein écran, ouverture du clavier à chaque toucher ;
- guide d'installation de l'application ;
- effacement de toutes les données.

**Partager vers ISPF** : une fois installée, l'application apparaît sous le nom **ISPF**, avec son logo, dans le menu **Partager** d'Android (gestionnaire de fichiers, Gmail, Drive…). Le fichier reçu est copié dans `~/partages` (un suffixe `(1)`, `(2)`… évite d'écraser un fichier différent ; le même fichier reçu deux fois n'est pas dupliqué) et s'ouvre directement dans l'éditeur en mode **VIEW** ; F3 mène ensuite au menu principal. Un texte ou un lien partagé sans fichier devient un fichier `partage-….txt`. Si plusieurs fichiers sont partagés, ils sont tous copiés et le premier est affiché.

**Sur PC (Windows, macOS, Linux)** : installez l'application depuis Chrome ou Edge (icône **Installer** dans la barre d'adresse, ou menu → *Applications* → *Installer ISPF*). Elle devient une application ISPF du menu Démarrer et de la barre des tâches, et elle est déclarée pour les fichiers texte et mainframe (`.txt`, `.log`, `.cbl`, `.cob`, `.cpy`, `.jcl`, `.rexx`, `.rex`, `.exec`, `.clist`, `.asm`, `.mac`, `.pli`, `.csv`, `.json`, `.xml`, `.xmi`, `.xmit`, `.dmp`…, voir `file_handlers` dans `public/manifest.webmanifest`). Dans l'Explorateur de fichiers : clic droit → **Ouvrir avec** → **ISPF** (la première fois, le navigateur demande l'autorisation). Le fichier est copié dans `~/partages` et s'ouvre en **VIEW**. Si ISPF est déjà lancé, la fenêtre existante est réutilisée et le fichier s'ouvre dans un **nouvel écran logique** (comme `START`) : le travail en cours est conservé et F3 y revient. Avec **Edge**, ISPF figure aussi dans le menu **Partager** de Windows (clic droit → Partager), qui suit le même chemin que le partage Android ; Chrome sous Windows ne gère pas ce menu.

**Logo** : les icônes sont générées par `build.js` à partir de `assets/ispf-logo.png` (dessin sombre sur fond clair, PNG 8 bits ; `--logo FICHIER` pour en utiliser un autre).

**Scripts REXX et services TSO** : depuis EDIT ou VIEW, la commande `RUN nom` exécute un script de `~/.lspf-node/rexx/`. Les services TSO de node-lspf sont disponibles :
- `ALLOC`, `FREE` ;
- `EXECIO DISKR/DISKW` ;
- la pile REXX ;
- `CALL *(AMBLIST)` ;
- `LMINIT` et `VIEW DATAID`.

Les data sets sont des fichiers du stockage de l'application. Un nom MVS comme `'MY.LOADLIB'` est cherché dans le répertoire du fichier affiché, dans `~` puis dans `~/partages`. Un fichier XMIT partagé depuis Android est donc trouvé directement, même renommé (`MY.LOADLIB(1).XMIT`, `my.loadlib.xmit.bin`). Une écriture dans `/lspf` (bibliothèques en lecture seule) donne `READ-ONLY FILE SYSTEM` et `EXECIO` RC 20. Les fichiers temporaires (`ALLOC … NEW` sans nom) sont supprimés à la fin du script.

## Fichiers

| Chemin | Contenu |
|---|---|
| `/home/lspf` | vos fichiers (répertoire courant, `~`). Au premier lancement, il contient `LISEZMOI.txt` et `exemples/` (COBOL, JCL, fichier à lignes longues) |
| `/home/lspf/.lspf-node` | profils, tables, journaux, et `rexx/` pour vos macros d'édition |
| `/lspf` | bibliothèques de node-lspf en lecture seule (`plib`, `mlib`, `help`, `rexx` avec EXMACRO, SUPALL, SUPFIND, SUPRES) |

Les noms de fichiers **ne tiennent pas compte de la casse**, comme sous Windows : la ligne de commande ISPF est en majuscules, donc `ED ~/EXEMPLES/PROG01.CBL` ouvre `~/exemples/PROG01.cbl`. La casse d'origine est conservée.

Les données restent dans le navigateur du téléphone. Elles disparaissent si l'on désinstalle l'application ou efface les données du site : faites des sauvegardes (menu ☰).

**Dumps z/OS.** Un SYSMDUMP (ou un dump SVC) copié ou partagé dans le stockage de l'application apparaît avec le type `Dump` dans la liste 3.4 ; le toucher ouvre l'analyseur de node-lspf (résumé, tâches, modules, mémoire en hexadécimal, `LIST`, `FIND`, `WHERE`, `REPORT`), que le dump ait été transféré en binaire ou en mode texte. Le dump est chargé en entier dans la mémoire du navigateur : sur un téléphone, cela convient à des dumps de quelques dizaines de mégaoctets.

**ZIP et XMIT.** Les commandes de ligne de la 3.4 fonctionnent comme dans node-lspf : `ZIP` crée une archive (chiffrement AES-256 ou ZipCrypto possible), `UNZIP` l'extrait, `XMIT` crée un fichier TSO TRANSMIT (un répertoire devient un PDS), `XE` extrait un XMIT (« unxmit »). Les archives sont au format ZIP standard (DEFLATE) ; comme dans node-lspf, choisir ZipCrypto pour une archive chiffrée à ouvrir avec l'Explorateur Windows. La compression est un peu moins forte que celle de zlib (codes de Huffman fixes, environ 10 % de plus sur du texte).

**Aide contextuelle.** Dans la 3.4, F1 avec le curseur sur une ligne, ou `?` devant l'entrée, affiche les commandes possibles pour cette entrée selon son type (XE / XM pour un fichier XMIT, XMIT / ZIP pour un répertoire, UNZIP pour une archive…).

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
build.js             construit www/ : bundle, icônes PNG (générées depuis assets/ispf-logo.png), service worker versionné
serve.js             serveur statique de test (gzip, types MIME, manifest)
public/              index.html, app.css, manifest.webmanifest
src/main.js          démarrage, cycle de vie de la session, barre de touches, menu, import / export / sauvegarde
src/webterm.js       terminal canvas (même interface que lib/terminal.js de node-lspf) et gestes tactiles
src/input.js         clavier physique (keydown) et clavier virtuel Android (textarea + différences)
src/vfs.js           système de fichiers virtuel synchrone (descripteurs en lecture et en écriture, Buffer), persistance IndexedDB
src/shims/           fs, path, os, events, process, child_process, zlib (deflate / inflate), crypto (SHA-1,
                     HMAC, PBKDF2, AES) pour le navigateur, synchrones, en JavaScript pur
src/loader.js        chargeur de modules CommonJS du bundle
src-sw/sw.js         service worker (cache hors connexion)
test/                tests (Node isolé, Chrome sans interface)
www/                 résultat de la construction : le répertoire à publier
```

Licence : GPL v3, comme lspf et node-lspf.
