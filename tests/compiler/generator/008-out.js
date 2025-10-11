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
          type: 'foreach',
          values: {
            data: {
              exp: function () { return [[1, 2], [3, 4]]; }
            }
          },
          children: [{
            id: 4,
            values: {
              data: {
                exp: function () { return ''; }
              }
            },
            children: [{
              id: 5,
              type: 'foreach',
              values: {
                data: {
                  exp: function () { return this.$parent.data; },
                  deps: [function () { return this.$parent.$value('data'); }]
                }
              },
              children: [{
                id: 6,
                values: {
                  data: {
                    exp: function () { return ''; }
                  },
                  text$6_0: {
                    exp: function () { return this.data; },
                    deps: [function () { return this.$value('data'); }]
                  }
                },
                children: []
              }]
            }]
          }]
        }]
      }
    ]
});