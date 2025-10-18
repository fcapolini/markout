({
  id: 0,
  name: 'page',
      children: [
        {
          id: 1,
          name: 'head',
          children: []
        },
        {
          id: 2,
          name: 'body',
          children: [
            {
              id: 3,
              values: {
                // Single expressions preserve their types
                count: {
                  exp: function() { return 42; }
                },
                flag: {
                  exp: function() { return true; }  
                },
                text: {
                  exp: function() { return 'hello'; }
                }
              },
              children: [
                {
                  id: 4,
                  values: {
                    // Interpolated expressions become template literals (strings)
                    msg: {
                      exp: function() { return `Count is ${this.count}`; },
                      deps: [function() { return this.$value('count'); }]
                    },
                    info: {
                      exp: function() { return `Flag: ${this.flag}`; },
                      deps: [function() { return this.$value('flag'); }]
                    },
                    greeting: {
                      exp: function() { return `Hello ${this.text}!`; },
                      deps: [function() { return this.$value('text'); }]
                    }
                  },
                  children: []
                }
              ]
            }
          ]
        }
      ]
});