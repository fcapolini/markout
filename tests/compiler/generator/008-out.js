({
  id: 0,
  children: [{
    id: 1,
    name: 'page',
    children: [
      {
        id: 2,
        name: 'head',
        children: []
      },
      {
        id: 3,
        name: 'body',
        children: [{
          id: 4,
          type: 'foreach',
          values: {
            data: {
              exp: function () { return [[1, 2], [3, 4]]; }
            }
          },
          children: [{
            id: 5,
            values: {
              data: {
                exp: function () { return ''; }
              }
            },
            children: [{
              id: 6,
              type: 'foreach',
              values: {
                data: {
                  exp: function () { return this.$parent.data; },
                  deps: [function () { return this.$parent.$value('data'); }]
                }
              },
              children: [{
                id: 7,
                values: {
                  data: {
                    exp: function () { return ''; }
                  },
                  text$7_0: {
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
  }]
});
