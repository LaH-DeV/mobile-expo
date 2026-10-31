"use strict";

window.SignalHuntHunts = [
  {
    id: "demo-square",
    title: {
      en: "The Square's Secret",
      pl: "Sekret placu",
    },
    story: {
      en: "An old gate. A copper clock. A quiet pavilion. Follow the details most people walk past.",
      pl: "Stara brama, miedziany zegar i cichy pawilon. Podążaj za szczegółami, które inni mijają.",
    },
    physical: true,
    illustration: "pavilion",
    estimatedDistanceKm: 0.8,
    estimatedDurationMinutes: 25,
    difficulty: "easy",
    terrain: {
      en: "Paving stones. Two steps at the pavilion.",
      pl: "Bruk. Dwa stopnie przy pawilonie.",
    },
    startDescription: {
      en: "Start at the square's north gate.",
      pl: "Zacznij przy północnej bramie placu.",
    },
    checkpoints: [
      {
        id: "gate",
        title: {
          en: "The north gate",
          pl: "Północna brama",
        },
        position: [52.23, 21.01],
        questions: [
          {
            id: "gate.date",
            type: "numeric",
            prompt: {
              en: "Which year is written above the gate?",
              pl: "Jaki rok widnieje nad bramą?",
            },
            accepted: {
              en: ["1924"],
              pl: ["1924"],
            },
            hints: {
              en: ["Look for four digits above the entrance."],
              pl: ["Poszukaj czterech cyfr nad wejściem."],
            },
            explanation: {
              en: "The gate reads 1924.",
              pl: "Na bramie widnieje rok 1924.",
            },
          },
        ],
      },
      {
        id: "clock",
        title: {
          en: "The copper clock",
          pl: "Miedziany zegar",
        },
        position: [52.2305, 21.0105],
        questions: [
          {
            id: "clock.colour",
            type: "text",
            prompt: {
              en: "What colour is the clock face?",
              pl: "Jakiego koloru jest tarcza zegara?",
            },
            accepted: {
              en: ["copper"],
              pl: ["miedziany", "miedziana"],
            },
            hints: {
              en: ["Look at the surface behind the hands."],
              pl: ["Przyjrzyj się powierzchni za wskazówkami."],
            },
            explanation: {
              en: "The face is copper-coloured.",
              pl: "Tarcza ma miedziany kolor.",
            },
          },
        ],
      },
      {
        id: "pavilion",
        title: {
          en: "The pavilion",
          pl: "Pawilon",
        },
        position: [52.231, 21.011],
        questions: [
          {
            id: "pavilion.columns",
            type: "numeric",
            prompt: {
              en: "How many columns face the square?",
              pl: "Ile kolumn stoi od strony placu?",
            },
            accepted: {
              en: ["3"],
              pl: ["3"],
            },
            hints: {
              en: ["Count only the front columns."],
              pl: ["Policz tylko kolumny od frontu."],
            },
            explanation: {
              en: "There are three columns at the front.",
              pl: "Od frontu są trzy kolumny.",
            },
          },
          {
            id: "pavilion.symbol",
            type: "choice",
            prompt: {
              en: "What does the pavilion's symbol depict?",
              pl: "Co przedstawia znak na pawilonie?",
            },
            accepted: {
              en: ["bird"],
              pl: ["bird"],
            },
            options: [
              {
                id: "bird",
                en: "Bird",
                pl: "Ptak",
              },
              {
                id: "tree",
                en: "Tree",
                pl: "Drzewo",
              },
              {
                id: "sun",
                en: "Sun",
                pl: "Słońce",
              },
            ],
            hints: {
              en: ["Look at the symbol near the roof."],
              pl: ["Spójrz na znak przy dachu."],
            },
            explanation: {
              en: "The symbol depicts a bird.",
              pl: "Znak przedstawia ptaka.",
            },
          },
        ],
      },
    ],
  },
  {
    id: "clock-walk",
    title: {
      en: "The Clockmaker's Walk",
      pl: "Spacer zegarmistrza",
    },
    story: {
      en: "Take the same fictional square at a slower pace. This version ends with a discovery, not a container.",
      pl: "Odkryj ten sam fikcyjny plac w spokojniejszym tempie. Ta trasa kończy się zagadką, bez skrytki.",
    },
    physical: false,
    illustration: "pavilion",
    estimatedDistanceKm: 0.8,
    estimatedDurationMinutes: 25,
    difficulty: "easy",
    terrain: {
      en: "Paving stones. Two steps at the pavilion.",
      pl: "Bruk. Dwa stopnie przy pawilonie.",
    },
    startDescription: {
      en: "Start at the square's north gate.",
      pl: "Zacznij przy północnej bramie placu.",
    },
    checkpoints: [
      {
        id: "gate",
        title: {
          en: "The north gate",
          pl: "Północna brama",
        },
        position: [52.2307, 21.0124],
        questions: [
          {
            id: "gate.date",
            type: "numeric",
            prompt: {
              en: "Which year is written above the gate?",
              pl: "Jaki rok widnieje nad bramą?",
            },
            accepted: {
              en: ["1924"],
              pl: ["1924"],
            },
            hints: {
              en: ["Look for four digits above the entrance."],
              pl: ["Poszukaj czterech cyfr nad wejściem."],
            },
            explanation: {
              en: "The gate reads 1924.",
              pl: "Na bramie widnieje rok 1924.",
            },
          },
        ],
      },
      {
        id: "clock",
        title: {
          en: "The copper clock",
          pl: "Miedziany zegar",
        },
        position: [52.2305, 21.0105],
        questions: [
          {
            id: "clock.colour",
            type: "text",
            prompt: {
              en: "What colour is the clock face?",
              pl: "Jakiego koloru jest tarcza zegara?",
            },
            accepted: {
              en: ["copper"],
              pl: ["miedziany", "miedziana"],
            },
            hints: {
              en: ["Look at the surface behind the hands."],
              pl: ["Przyjrzyj się powierzchni za wskazówkami."],
            },
            explanation: {
              en: "The face is copper-coloured.",
              pl: "Tarcza ma miedziany kolor.",
            },
          },
        ],
      },
      {
        id: "pavilion",
        title: {
          en: "The pavilion",
          pl: "Pawilon",
        },
        position: [52.231, 21.011],
        questions: [
          {
            id: "pavilion.columns",
            type: "numeric",
            prompt: {
              en: "How many columns face the square?",
              pl: "Ile kolumn stoi od strony placu?",
            },
            accepted: {
              en: ["3"],
              pl: ["3"],
            },
            hints: {
              en: ["Count only the front columns."],
              pl: ["Policz tylko kolumny od frontu."],
            },
            explanation: {
              en: "There are three columns at the front.",
              pl: "Od frontu są trzy kolumny.",
            },
          },
          {
            id: "pavilion.symbol",
            type: "choice",
            prompt: {
              en: "What does the pavilion's symbol depict?",
              pl: "Co przedstawia znak na pawilonie?",
            },
            accepted: {
              en: ["bird"],
              pl: ["bird"],
            },
            options: [
              {
                id: "bird",
                en: "Bird",
                pl: "Ptak",
              },
              {
                id: "tree",
                en: "Tree",
                pl: "Drzewo",
              },
              {
                id: "sun",
                en: "Sun",
                pl: "Słońce",
              },
            ],
            hints: {
              en: ["Look at the symbol near the roof."],
              pl: ["Spójrz na znak przy dachu."],
            },
            explanation: {
              en: "The symbol depicts a bird.",
              pl: "Znak przedstawia ptaka.",
            },
          },
        ],
      },
    ],
  },
];
