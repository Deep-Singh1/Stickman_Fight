\# Game Design Document (GDD)



\## Title

StickFight (working title)



\## Genre

1-v-1 browser fighting game



\## Goal

Defeat the other player by reducing their HP to 0 within 90 seconds.



\## Controls (Keyboard)

\- \*\*Move Left:\*\* ←  

\- \*\*Move Right:\*\* →  

\- \*\*Jump:\*\* ↑  

\- \*\*Light Attack:\*\* Z  

\- \*\*Heavy Attack:\*\* X  

\- \*\*Block:\*\* C  



\## Moves

\- \*\*Light Attack:\*\* Fast, small damage (8 HP).  

\- \*\*Heavy Attack:\*\* Slow, big damage (18 HP).  

\- \*\*Block:\*\* Reduces incoming damage by 60%.  



\## Health \& Damage

\- Starting HP: \*\*100\*\* for each player.  

\- Damage: Light = 8, Heavy = 18.  

\- Block reduces damage taken by 60%.  



\## Win Condition

\- Best of 3 rounds, or highest HP when timer ends.



\## Graphics \& Camera

\- 2D Canvas.  

\- Simple stickmen drawn with lines/circles.  

\- One flat stage background.  



\## Networking

\- \*\*WebSockets\*\* for real-time multiplayer.  

\- Server acts as the referee (authoritative).  

\- Goal: 60 ms tick (smooth but simple).  



\## Anti-Cheat (Basic)

\- Client only sends input (move left, jump, attack).  

\- Server checks collisions and applies damage.  



\## Stretch Goals (Optional, later if time)

\- Special move after a combo.  

\- Sound effects.  

\- Basic animation frames.  



\## Out of Scope (for this thesis)

\- Ranked mode.  

\- Inventory system.  

\- Character selection screen.



