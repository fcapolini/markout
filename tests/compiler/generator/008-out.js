({
  __id: 0,
  __children: [{
    __id: 1,
    __name: 'page',
    __children: [
      {
        __id: 2,
        __name: 'head',
        __children: []
      },
      {
        __id: 3,
        __name: 'body',
        __children: [{
          __id: 4,
          __type: 'foreach',
          data: {
            e: function () { return [[1, 2], [3, 4]]; }
          },
          __children: [{
            __id: 5,
            data: {
              e: function () { return ''; }
            },
            __children: [{
              __id: 6,
              __type: 'foreach',
              data: {
                e: function () { return this.__parent.data; },
                r: [function () { return this.__parent.__value('data'); }]
              },
              __children: [{
                __id: 7,
                data: {
                  e: function () { return ''; }
                },
                text_7_0: {
                  e: function () { return this.data; },
                  r: [function () { return this.__value('data'); }]
                },
                __children: []
              }]
            }]
          }]
        }]
      }
    ]
  }]
});
