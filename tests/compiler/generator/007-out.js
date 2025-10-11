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
              exp: function () { return [1, 2]; }
            }
          },
          children: [{
            id: 4,
            values: {
              data: {
                exp: function () { return ''; }
              },
              text$4_0: {
                exp: function () { return this.data; },
                deps: [function () { return this.$value('data'); }]
              }
            },
            children: []
          }]
        }]
      }
    ]
});