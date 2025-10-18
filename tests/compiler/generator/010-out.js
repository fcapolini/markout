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
      children: [{
        id: 3,
        values: {
          count: {
            exp: function () {
              return 42;
            }
          },
          flag: {
            exp: function () {
              return true;
            }
          },
          text: {
            exp: function () {
              return 'test';
            }
          },
          obj: {
            exp: function () {
              return { name: 'John' };
            }
          },
          arr: {
            exp: function () {
              return [
                1,
                2,
                3
              ];
            }
          },
          text$3_0: {
            exp: function () {
              return typeof this.count;
            },
            deps: [function () {
              return this.$value('count');
            }]
          },
          text$3_1: {
            exp: function () {
              return typeof this.flag;
            },
            deps: [function () {
              return this.$value('flag');
            }]
          },
          text$3_2: {
            exp: function () {
              return typeof this.text;
            },
            deps: [function () {
              return this.$value('text');
            }]
          },
          text$3_3: {
            exp: function () {
              return typeof this.obj;
            },
            deps: [function () {
              return this.$value('obj');
            }]
          },
          text$3_4: {
            exp: function () {
              return typeof this.arr;
            },
            deps: [function () {
              return this.$value('arr');
            }]
          }
        },
        children: []
      }]
    }
  ]
});