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
              exp: function () { return [1, 2]; }
            }
          },
          children: [{
            id: 5,
            values: {
              data: {
                exp: function () { return ''; }
              },
              text$5_0: {
                exp: function () { return this.data; },
                deps: [function () { return this.$value('data'); }]
              }
            },
            children: []
          }]
        }]
      }
    ]
  }]
});
